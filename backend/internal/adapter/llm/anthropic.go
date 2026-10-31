// Package llm implements usecase.AgentModel: live Claude (anthropic-sdk-go v2) and replay from recordings.
package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
)

// Server-side refusal fallback: a policy decline is re-served by the model's default fallback in the same call.
const fallbackBeta = "server-side-fallback-2026-07-01"

type liveModel struct {
	client anthropic.Client
	model  string
}

func newLiveModel(apiKey, model string) *liveModel {
	return &liveModel{client: anthropic.NewClient(option.WithAPIKey(apiKey)), model: model}
}

// liveSession owns the native message history, so thinking blocks go back to the API unchanged.
type liveSession struct {
	m          *liveModel
	system     string
	prompt     string
	tools      []anthropic.BetaToolUnionParam
	submitOnly []anthropic.BetaToolUnionParam
	finalTool  string // submitVerdict (investigate) or submitFixPlan (Fix-it)
	messages   []anthropic.BetaMessageParam
}

func (m *liveModel) start(system, prompt string, specs []usecase.ToolSpec) *liveSession {
	s := &liveSession{m: m, system: system, prompt: prompt}
	for _, spec := range specs {
		t := anthropic.BetaToolParam{
			Name:        spec.Name,
			Description: anthropic.String(spec.Description),
			InputSchema: anthropic.BetaToolInputSchemaParam{
				Properties:  spec.Properties,
				Required:    spec.Required,
				ExtraFields: map[string]any{"additionalProperties": false},
			},
		}
		u := anthropic.BetaToolUnionParam{OfTool: &t}
		s.tools = append(s.tools, u)
		if spec.Name == usecase.ToolSubmitVerdict || spec.Name == usecase.ToolSubmitFixPlan {
			s.submitOnly = []anthropic.BetaToolUnionParam{u}
			s.finalTool = spec.Name
		}
	}
	return s
}

func (s *liveSession) Next(ctx context.Context, results []usecase.ToolResult, finalStep bool) (usecase.Turn, error) {
	var blocks []anthropic.BetaContentBlockParamUnion
	if len(s.messages) == 0 {
		blocks = append(blocks, anthropic.NewBetaTextBlock(s.prompt))
	}
	for _, r := range results {
		blocks = append(blocks, anthropic.NewBetaToolResultBlock(r.CallID, r.Content, r.IsError))
	}
	if len(s.messages) > 0 && len(results) == 0 {
		blocks = append(blocks, anthropic.NewBetaTextBlock("Use the tools, then call "+s.finalTool+"."))
	}
	tools := s.tools
	if finalStep {
		// Forced tool_choice is rejected on current models: offer only submitVerdict and say so.
		tools = s.submitOnly
		note := usecase.FinalStepNote
		if s.finalTool == usecase.ToolSubmitFixPlan {
			note = usecase.FixFinalStepNote
		}
		blocks = append(blocks, anthropic.NewBetaTextBlock(note))
	}
	s.messages = append(s.messages, anthropic.NewBetaUserMessage(blocks...))

	resp, err := s.m.client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
		Model:        anthropic.Model(s.m.model),
		MaxTokens:    16000,
		System:       []anthropic.BetaTextBlockParam{{Text: s.system}},
		Messages:     s.messages,
		Tools:        tools,
		OutputConfig: anthropic.BetaOutputConfigParam{Effort: "medium"},
		Fallbacks:    anthropic.BetaFallbacksParamOfDefault(),
		Betas:        []anthropic.AnthropicBeta{fallbackBeta},
	})
	if err != nil {
		var apiErr *anthropic.Error
		if errors.As(err, &apiErr) && (apiErr.StatusCode == 401 || apiErr.StatusCode == 403) {
			return usecase.Turn{}, entity.Fail(entity.ErrLLMUnavailable, "The Anthropic API rejected the key (HTTP %d).", apiErr.StatusCode)
		}
		return usecase.Turn{}, fmt.Errorf("anthropic messages: %w", err)
	}
	if resp.StopReason == "refusal" {
		return usecase.Turn{}, fmt.Errorf("model declined the request (refusal)")
	}
	s.messages = append(s.messages, resp.ToParam())

	var turn usecase.Turn
	var text []string
	for _, block := range resp.Content {
		switch b := block.AsAny().(type) {
		case anthropic.BetaTextBlock:
			if t := strings.TrimSpace(b.Text); t != "" {
				text = append(text, t)
			}
		case anthropic.BetaToolUseBlock:
			turn.Calls = append(turn.Calls, usecase.ToolCall{ID: b.ID, Name: b.Name, Input: json.RawMessage(b.JSON.Input.Raw())})
		}
	}
	turn.Text = strings.Join(text, " ")
	return turn, nil
}

func (s *liveSession) Close(bool) {}
