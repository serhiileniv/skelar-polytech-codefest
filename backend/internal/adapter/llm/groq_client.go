package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// DefaultGroqBaseURL is Groq's OpenAI-compatible endpoint.
const DefaultGroqBaseURL = "https://api.groq.com/openai/v1"

const (
	maxRetries     = 3                // per call, for 429 / 5xx / transport errors
	baseBackoff    = time.Second      // doubled per retry when no retry-after
	maxBackoff     = 20 * time.Second // cap on a server-requested wait
	requestTimeout = 90 * time.Second
	maxErrorBody   = 2048
)

// OpenAI Chat Completions wire types (only the fields we use).

type chatMessage struct {
	Role       string     `json:"role"`
	Content    *string    `json:"content"`
	ToolCalls  []toolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

type toolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function functionCall `json:"function"`
}

type functionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // a JSON string, per the OpenAI format
}

type toolDef struct {
	Type     string      `json:"type"`
	Function functionDef `json:"function"`
}

type functionDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters"`
}

type chatRequest struct {
	Model               string        `json:"model"`
	Messages            []chatMessage `json:"messages"`
	Tools               []toolDef     `json:"tools,omitempty"`
	ToolChoice          any           `json:"tool_choice,omitempty"`
	MaxCompletionTokens int           `json:"max_completion_tokens,omitempty"`
	ReasoningEffort     string        `json:"reasoning_effort,omitempty"`
	Temperature         *float64      `json:"temperature,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message      chatMessage `json:"message"`
		FinishReason string      `json:"finish_reason"`
	} `json:"choices"`
}

type apiError struct {
	Error struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error"`
}

func strPtr(s string) *string { return &s }

func forceTool(name string) map[string]any {
	return map[string]any{"type": "function", "function": map[string]any{"name": name}}
}

// groqClient calls /chat/completions with retries on rate limits, 5xx and transport errors.
type groqClient struct {
	http    *http.Client
	baseURL string
	apiKey  string
	model   string
	sleep   func(ctx context.Context, d time.Duration) error // injected in tests
	now     func() time.Time
	tokens  tokenBudget
}

// tokenBudget mirrors Groq's x-ratelimit-*-tokens headers so a call waits for the per-minute token
// budget instead of burning a 429 (the free tier allows ~8k tokens/min, about 3 agent steps).
type tokenBudget struct {
	mu        sync.Mutex
	known     bool
	limit     int
	remaining int
	resetAt   time.Time
}

// charsPerToken and outputReserve estimate a request's token cost from its JSON size.
const (
	charsPerToken = 4
	outputReserve = 600
)

// wait returns how long to pause before spending est tokens, and reserves them.
func (b *tokenBudget) wait(est int, now time.Time) time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.known || !now.Before(b.resetAt) {
		b.known = false
		return 0
	}
	short := est - b.remaining
	b.remaining -= est
	if short <= 0 || b.limit <= 0 {
		return 0
	}
	// The bucket refills linearly over a minute; never wait past the full reset.
	d := time.Duration(float64(short) / float64(b.limit) * float64(time.Minute))
	return min(d, b.resetAt.Sub(now), maxBackoff)
}

func (b *tokenBudget) update(h http.Header, now time.Time) {
	limit, errL := strconv.Atoi(h.Get("x-ratelimit-limit-tokens"))
	remaining, errR := strconv.Atoi(h.Get("x-ratelimit-remaining-tokens"))
	reset, errT := time.ParseDuration(h.Get("x-ratelimit-reset-tokens"))
	if errL != nil || errR != nil || errT != nil {
		return
	}
	b.mu.Lock()
	b.known, b.limit, b.remaining, b.resetAt = true, limit, remaining, now.Add(reset)
	b.mu.Unlock()
}

func newGroqClient(apiKey, model, baseURL string) *groqClient {
	if baseURL == "" {
		baseURL = DefaultGroqBaseURL
	}
	return &groqClient{http: &http.Client{Timeout: requestTimeout}, baseURL: strings.TrimRight(baseURL, "/"),
		apiKey: apiKey, model: model, sleep: sleepCtx, now: time.Now}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}

// reasoningEffort: gpt-oss takes low|medium|high; other Groq models reject unknown values, so send none.
func (c *groqClient) reasoningEffort(effort string) string {
	if strings.HasPrefix(c.model, "openai/gpt-oss") {
		return effort
	}
	return ""
}

func (c *groqClient) chat(ctx context.Context, req chatRequest) (chatMessage, error) {
	req.Model = c.model
	body, err := json.Marshal(req)
	if err != nil {
		return chatMessage{}, fmt.Errorf("groq request: %w", err)
	}
	est := len(body)/charsPerToken + outputReserve
	for attempt := 0; ; attempt++ {
		if d := c.tokens.wait(est, c.now()); d > 0 {
			slog.Debug("groq pacing for token budget", "wait", d)
			if err := c.sleep(ctx, d); err != nil {
				return chatMessage{}, err
			}
		}
		msg, retryAfter, err := c.once(ctx, body)
		if err == nil {
			return msg, nil
		}
		var re *retryable
		if !errors.As(err, &re) || attempt >= maxRetries {
			return chatMessage{}, err
		}
		wait := retryAfter
		if wait <= 0 {
			wait = baseBackoff << attempt
		}
		wait = min(wait, maxBackoff)
		slog.Warn("groq retry", "attempt", attempt+1, "wait", wait, "reason", re.reason)
		if err := c.sleep(ctx, wait); err != nil {
			return chatMessage{}, err
		}
	}
}

// retryable marks a failure worth another attempt.
type retryable struct{ reason string }

func (r *retryable) Error() string { return "groq: " + r.reason }

// toolUseFailed: Groq rejected the model's tool call (arguments did not match the schema).
type toolUseFailed struct{ msg string }

func (t *toolUseFailed) Error() string { return "groq tool_use_failed: " + t.msg }

func (c *groqClient) once(ctx context.Context, body []byte) (chatMessage, time.Duration, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return chatMessage{}, 0, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		if ctx.Err() != nil {
			return chatMessage{}, 0, ctx.Err()
		}
		return chatMessage{}, 0, &retryable{reason: "transport: " + err.Error()}
	}
	defer resp.Body.Close()
	c.tokens.update(resp.Header, c.now())
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return chatMessage{}, 0, fmt.Errorf("groq read: %w", err)
	}
	if resp.StatusCode == http.StatusOK {
		var out chatResponse
		if err := json.Unmarshal(raw, &out); err != nil {
			return chatMessage{}, 0, fmt.Errorf("groq decode: %w", err)
		}
		if len(out.Choices) == 0 {
			return chatMessage{}, 0, errors.New("groq: response has no choices")
		}
		return out.Choices[0].Message, 0, nil
	}
	return chatMessage{}, retryAfter(resp.Header.Get("retry-after")), statusError(resp.StatusCode, raw)
}

func statusError(status int, raw []byte) error {
	var e apiError
	_ = json.Unmarshal(raw, &e)
	msg := e.Error.Message
	if msg == "" {
		msg = string(raw[:min(len(raw), maxErrorBody)])
	}
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return entity.Fail(entity.ErrLLMUnavailable, "The Groq API rejected the key (HTTP %d).", status)
	case status == http.StatusTooManyRequests:
		return &retryable{reason: "rate limited: " + msg}
	case status >= 500:
		return &retryable{reason: fmt.Sprintf("HTTP %d: %s", status, msg)}
	case e.Error.Code == "tool_use_failed":
		// Groq checks tool arguments against the schema server-side; the session feeds this back to the model.
		return &toolUseFailed{msg: msg}
	}
	return fmt.Errorf("groq HTTP %d: %s", status, msg)
}

// retryAfter parses the header as seconds (Groq sends seconds, possibly fractional).
func retryAfter(v string) time.Duration {
	s, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || s <= 0 {
		return 0
	}
	return time.Duration(s * float64(time.Second))
}
