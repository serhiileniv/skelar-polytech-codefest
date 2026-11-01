package llm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
)

// fakeGroq serves scripted responses in order and records every request body.
type fakeGroq struct {
	mu        sync.Mutex
	responses []fakeResp
	requests  []chatRequest
}

type fakeResp struct {
	status     int
	retryAfter string
	body       string
}

func (f *fakeGroq) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var req chatRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	f.requests = append(f.requests, req)
	if r.Header.Get("Authorization") != "Bearer test-key" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	resp := fakeResp{status: 500, body: `{"error":{"message":"script exhausted"}}`}
	if len(f.requests) <= len(f.responses) {
		resp = f.responses[len(f.requests)-1]
	}
	if resp.retryAfter != "" {
		w.Header().Set("retry-after", resp.retryAfter)
	}
	w.WriteHeader(resp.status)
	_, _ = w.Write([]byte(resp.body))
}

func okText(text string) fakeResp {
	b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": text}}}})
	return fakeResp{status: 200, body: string(b)}
}

func okCall(text, id, name, args string) fakeResp {
	b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{
		"role": "assistant", "content": text,
		"tool_calls": []any{map[string]any{"id": id, "type": "function", "function": map[string]any{"name": name, "arguments": args}}},
	}}}})
	return fakeResp{status: 200, body: string(b)}
}

func newTestClient(t *testing.T, f *fakeGroq, key string) (*groqClient, *[]time.Duration) {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	c := newGroqClient(key, "openai/gpt-oss-120b", srv.URL)
	var waits []time.Duration
	c.sleep = func(_ context.Context, d time.Duration) error { waits = append(waits, d); return nil }
	return c, &waits
}

var testTools = []usecase.ToolSpec{
	{Name: "getChat", Description: "chat", Properties: map[string]any{}},
	{Name: usecase.ToolSubmitVerdict, Description: "submit", Properties: map[string]any{"outcome": map[string]any{"type": "string"}}, Required: []string{"outcome"}},
}

func TestChatRetries(t *testing.T) {
	rateLimited := fakeResp{status: 429, retryAfter: "2", body: `{"error":{"message":"slow down"}}`}
	toolFailed := fakeResp{status: 400, body: `{"error":{"message":"bad call","code":"tool_use_failed"}}`}
	tests := []struct {
		name      string
		responses []fakeResp
		key       string
		wantText  string
		wantErr   error // sentinel checked with errors.Is; nil = success
		wantCalls int
		wantWaits []time.Duration
	}{
		{"ok first try", []fakeResp{okText("hi")}, "test-key", "hi", nil, 1, nil},
		{"429 honors retry-after", []fakeResp{rateLimited, okText("hi")}, "test-key", "hi", nil, 2, []time.Duration{2 * time.Second}},
		{"429 then 5xx backs off", []fakeResp{{status: 429}, {status: 503}, okText("hi")}, "test-key", "hi", nil, 3, []time.Duration{time.Second, 2 * time.Second}},
		{"tool_use_failed left to the session", []fakeResp{toolFailed, okText("hi")}, "test-key", "", errOther, 1, nil},
		{"gives up after 3 retries", []fakeResp{rateLimited, rateLimited, rateLimited, rateLimited, okText("late")}, "test-key", "", errRetryable, 4,
			[]time.Duration{2 * time.Second, 2 * time.Second, 2 * time.Second}},
		{"bad key is llm_unavailable", nil, "wrong", "", entity.ErrLLMUnavailable, 1, nil},
		{"plain 400 not retried", []fakeResp{{status: 400, body: `{"error":{"message":"bad"}}`}}, "test-key", "", errOther, 1, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakeGroq{responses: tt.responses}
			c, waits := newTestClient(t, f, tt.key)
			msg, err := c.chat(context.Background(), chatRequest{Messages: []chatMessage{{Role: "user", Content: strPtr("q")}}})
			switch tt.wantErr {
			case nil:
				if err != nil || msg.Content == nil || *msg.Content != tt.wantText {
					t.Fatalf("got %v, %v; want %q", msg.Content, err, tt.wantText)
				}
			case errRetryable:
				var re *retryable
				if !errors.As(err, &re) {
					t.Fatalf("err = %v, want retryable", err)
				}
			case errOther:
				var re *retryable
				if err == nil || errors.As(err, &re) || errors.Is(err, entity.ErrLLMUnavailable) {
					t.Fatalf("err = %v, want a non-retryable error", err)
				}
			default:
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
			}
			if len(f.requests) != tt.wantCalls {
				t.Errorf("requests = %d, want %d", len(f.requests), tt.wantCalls)
			}
			if len(*waits) != len(tt.wantWaits) {
				t.Fatalf("waits = %v, want %v", *waits, tt.wantWaits)
			}
			for i := range tt.wantWaits {
				if (*waits)[i] != tt.wantWaits[i] {
					t.Errorf("wait[%d] = %v, want %v", i, (*waits)[i], tt.wantWaits[i])
				}
			}
		})
	}
}

var (
	errRetryable = errors.New("retryable")
	errOther     = errors.New("other")
)

func TestArgsOf(t *testing.T) {
	tests := []struct{ in, want string }{
		{"", `{}`},
		{"null", `{}`},
		{`{"a":1}`, `{"a":1}`},
		{` {"a":1} `, `{"a":1}`},
		{`{"a":`, `"{\"a\":"`}, // invalid JSON → string, rejected by strict decoding
		{`[1]`, `"[1]"`},
	}
	for _, tt := range tests {
		if got := string(argsOf(tt.in)); got != tt.want {
			t.Errorf("argsOf(%q) = %s, want %s", tt.in, got, tt.want)
		}
	}
}

func TestSessionMapsToolResultsAndForcesFinalTool(t *testing.T) {
	f := &fakeGroq{responses: []fakeResp{
		okCall("Reading the chat.", "call_1", "getChat", ""),
		okText("I am done."), // final step: text instead of submitVerdict → one forced retry
		okCall("", "call_2", usecase.ToolSubmitVerdict, `{"outcome":"suspicious"}`),
	}}
	c, _ := newTestClient(t, f, "test-key")
	s := c.start("sys", "case prompt", testTools)
	ctx := context.Background()

	turn, err := s.Next(ctx, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if turn.Text != "Reading the chat." || len(turn.Calls) != 1 || string(turn.Calls[0].Input) != `{}` {
		t.Fatalf("turn 1 = %+v", turn)
	}
	turn, err = s.Next(ctx, []usecase.ToolResult{{CallID: "call_1", Content: `{"messages":[]}`}}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(turn.Calls) != 1 || turn.Calls[0].Name != usecase.ToolSubmitVerdict || string(turn.Calls[0].Input) != `{"outcome":"suspicious"}` {
		t.Fatalf("final turn = %+v", turn)
	}
	if turn.Text != "I am done." {
		t.Errorf("final text = %q", turn.Text)
	}

	if len(f.requests) != 3 {
		t.Fatalf("requests = %d", len(f.requests))
	}
	first := f.requests[0]
	if len(first.Tools) != 2 || first.ToolChoice != "auto" || first.ReasoningEffort != "medium" {
		t.Errorf("step 1 request: tools=%d choice=%v effort=%q", len(first.Tools), first.ToolChoice, first.ReasoningEffort)
	}
	for i, req := range f.requests[1:] {
		if len(req.Tools) != 1 || req.Tools[0].Function.Name != usecase.ToolSubmitVerdict {
			t.Errorf("final request %d offers %+v", i, req.Tools)
		}
		choice, _ := json.Marshal(req.ToolChoice)
		if !strings.Contains(string(choice), `"name":"submitVerdict"`) {
			t.Errorf("final request %d tool_choice = %s", i, choice)
		}
	}
	// History of the final request: system, user, assistant(call_1), tool(call_1), user(note).
	msgs := f.requests[1].Messages
	roles := make([]string, len(msgs))
	for i, m := range msgs {
		roles[i] = m.Role
	}
	if got := strings.Join(roles, ","); got != "system,user,assistant,tool,user" {
		t.Fatalf("roles = %s", got)
	}
	if msgs[3].ToolCallID != "call_1" || *msgs[3].Content != `{"messages":[]}` || *msgs[4].Content != usecase.FinalStepNote {
		t.Errorf("tool/note messages = %+v %+v", msgs[3], msgs[4])
	}
}

func TestToolDefOfStrictObject(t *testing.T) {
	d := toolDefOf(testTools[1])
	p := d.Function.Parameters
	if d.Type != "function" || p["type"] != "object" || p["additionalProperties"] != false {
		t.Fatalf("parameters = %+v", p)
	}
	if req, _ := p["required"].([]string); len(req) != 1 || req[0] != "outcome" {
		t.Errorf("required = %v", p["required"])
	}
	if _, ok := toolDefOf(testTools[0]).Function.Parameters["required"]; ok {
		t.Error("empty required must be omitted")
	}
}

func TestAnswerReplayIsUnavailable(t *testing.T) {
	r := NewRouter(Config{ForceReplay: true, APIKey: "x"})
	if _, err := r.Answer(context.Background(), "s", "p"); !errors.Is(err, entity.ErrLLMUnavailable) {
		t.Fatalf("err = %v", err)
	}
}

func TestTokenBudgetWait(t *testing.T) {
	now := time.Unix(1000, 0)
	hdr := func(limit, remaining, reset string) http.Header {
		h := http.Header{}
		h.Set("x-ratelimit-limit-tokens", limit)
		h.Set("x-ratelimit-remaining-tokens", remaining)
		h.Set("x-ratelimit-reset-tokens", reset)
		return h
	}
	tests := []struct {
		name string
		h    http.Header
		est  int
		at   time.Time
		want time.Duration
	}{
		{"no headers yet", http.Header{}, 3000, now, 0},
		{"enough left", hdr("8000", "5000", "20s"), 3000, now, 0},
		{"short 800 of 8000/min", hdr("8000", "2200", "40s"), 3000, now, 6 * time.Second},
		{"capped at reset", hdr("8000", "0", "3s"), 4000, now, 3 * time.Second},
		{"reset passed", hdr("8000", "0", "3s"), 4000, now.Add(5 * time.Second), 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var b tokenBudget
			b.update(tt.h, now)
			if got := b.wait(tt.est, tt.at); got != tt.want {
				t.Errorf("wait = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSessionReasksAfterToolUseFailed(t *testing.T) {
	toolFailed := fakeResp{status: 400, body: `{"error":{"message":"missing properties: 'confidence'","code":"tool_use_failed"}}`}
	tests := []struct {
		name      string
		responses []fakeResp
		wantOK    bool
		wantReqs  int
	}{
		{"recovers after one rejection", []fakeResp{toolFailed, okCall("", "c1", "getChat", "{}")}, true, 2},
		{"gives up after two re-asks", []fakeResp{toolFailed, toolFailed, toolFailed, okCall("", "c1", "getChat", "{}")}, false, 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakeGroq{responses: tt.responses}
			c, _ := newTestClient(t, f, "test-key")
			turn, err := c.start("sys", "prompt", testTools).Next(context.Background(), nil, false)
			if (err == nil) != tt.wantOK {
				t.Fatalf("err = %v, wantOK %v", err, tt.wantOK)
			}
			if tt.wantOK && (len(turn.Calls) != 1 || turn.Calls[0].Name != "getChat") {
				t.Errorf("turn = %+v", turn)
			}
			if len(f.requests) != tt.wantReqs {
				t.Fatalf("requests = %d, want %d", len(f.requests), tt.wantReqs)
			}
			last := f.requests[1].Messages
			if fb := last[len(last)-1]; fb.Role != "user" || !strings.Contains(*fb.Content, "confidence") {
				t.Errorf("feedback message = %+v", fb)
			}
		})
	}
}
