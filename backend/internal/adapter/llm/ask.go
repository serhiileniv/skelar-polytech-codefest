package llm

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// askMaxTokens leaves room for thinking plus a ~50-word answer.
const askMaxTokens = 4000

// Answer implements usecase.Answerer: one tool-less live call. In replay mode it reports ErrLLMUnavailable
// so the use case answers from the stored verdict.
func (r *Router) Answer(ctx context.Context, system, prompt string) (string, error) {
	if r.Replaying() {
		return "", entity.Fail(entity.ErrLLMUnavailable, "Ask runs live only; replay mode is on.")
	}
	m := r.live
	resp, err := m.client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
		Model:        anthropic.Model(m.model),
		MaxTokens:    askMaxTokens,
		System:       []anthropic.BetaTextBlockParam{{Text: system}},
		Messages:     []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(prompt))},
		OutputConfig: anthropic.BetaOutputConfigParam{Effort: "low"},
		Fallbacks:    anthropic.BetaFallbacksParamOfDefault(),
		Betas:        []anthropic.AnthropicBeta{fallbackBeta},
	})
	if err != nil {
		var apiErr *anthropic.Error
		if errors.As(err, &apiErr) && (apiErr.StatusCode == 401 || apiErr.StatusCode == 403) {
			return "", entity.Fail(entity.ErrLLMUnavailable, "The Anthropic API rejected the key (HTTP %d).", apiErr.StatusCode)
		}
		return "", fmt.Errorf("anthropic ask: %w", err)
	}
	if resp.StopReason == "refusal" {
		return "", fmt.Errorf("model declined the ask (refusal)")
	}
	var text []string
	for _, block := range resp.Content {
		if b, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			if t := strings.TrimSpace(b.Text); t != "" {
				text = append(text, t)
			}
		}
	}
	return strings.Join(text, " "), nil
}
