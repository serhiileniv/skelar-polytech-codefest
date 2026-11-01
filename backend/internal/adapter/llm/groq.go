// Package llm implements usecase.AgentModel and usecase.Answerer: live Groq (OpenAI-compatible) and replay from recordings.
package llm

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
)

const (
	toolRetries    = 2 // re-asks after Groq rejects a malformed tool call
	agentMaxTokens = 8000
	askMaxTokens   = 2000 // reasoning plus a ~50-word answer
)

// groqSession owns the OpenAI-format message history.
type groqSession struct {
	c         *groqClient
	tools     []toolDef
	finalOnly []toolDef
	finalTool string // submitVerdict (investigate) or submitFixPlan (Fix-it)
	messages  []chatMessage
	pending   []string // tool_call ids of the last assistant turn; each needs a "tool" message
}

func (c *groqClient) start(system, prompt string, specs []usecase.ToolSpec) *groqSession {
	s := &groqSession{c: c, messages: []chatMessage{
		{Role: "system", Content: strPtr(system)},
		{Role: "user", Content: strPtr(prompt)},
	}}
	for _, spec := range specs {
		t := toolDefOf(spec)
		s.tools = append(s.tools, t)
		if spec.Name == usecase.ToolSubmitVerdict || spec.Name == usecase.ToolSubmitFixPlan {
			s.finalOnly = []toolDef{t}
			s.finalTool = spec.Name
		}
	}
	return s
}

func toolDefOf(spec usecase.ToolSpec) toolDef {
	props := spec.Properties
	if props == nil {
		props = map[string]any{}
	}
	params := map[string]any{"type": "object", "properties": props, "additionalProperties": false}
	if len(spec.Required) > 0 {
		params["required"] = spec.Required
	}
	return toolDef{Type: "function", Function: functionDef{Name: spec.Name, Description: spec.Description, Parameters: params}}
}

func (s *groqSession) Next(ctx context.Context, results []usecase.ToolResult, finalStep bool) (usecase.Turn, error) {
	s.appendResults(results)
	if len(results) == 0 && len(s.messages) > 2 {
		s.messages = append(s.messages, chatMessage{Role: "user", Content: strPtr("Use the tools, then call " + s.finalTool + ".")})
	}
	if !finalStep {
		return s.call(ctx, chatRequest{Tools: s.tools, ToolChoice: "auto"})
	}
	note := usecase.FinalStepNote
	if s.finalTool == usecase.ToolSubmitFixPlan {
		note = usecase.FixFinalStepNote
	}
	s.messages = append(s.messages, chatMessage{Role: "user", Content: strPtr(note)})
	req := chatRequest{Tools: s.finalOnly, ToolChoice: forceTool(s.finalTool)}
	turn, err := s.call(ctx, req)
	if err != nil || s.calls(turn, s.finalTool) {
		return turn, err
	}
	// Text instead of the final tool: answer the stray calls, insist once more.
	slog.Warn("groq final step without final tool, retrying", "tool", s.finalTool)
	s.appendResults(nil)
	s.messages = append(s.messages, chatMessage{Role: "user", Content: strPtr("Call " + s.finalTool + " now. Do not reply with text.")})
	retry, err := s.call(ctx, req)
	if err != nil {
		return turn, err
	}
	retry.Text = strings.TrimSpace(turn.Text + " " + retry.Text)
	return retry, nil
}

func (s *groqSession) calls(t usecase.Turn, name string) bool {
	for _, c := range t.Calls {
		if c.Name == name {
			return true
		}
	}
	return false
}

// appendResults adds one "tool" message per pending call (the API rejects a history with an unanswered call).
func (s *groqSession) appendResults(results []usecase.ToolResult) {
	byID := make(map[string]usecase.ToolResult, len(results))
	for _, r := range results {
		byID[r.CallID] = r
	}
	for _, id := range s.pending {
		content := `{"error":"not executed"}`
		if r, ok := byID[id]; ok {
			content = r.Content
		}
		s.messages = append(s.messages, chatMessage{Role: "tool", ToolCallID: id, Content: strPtr(content)})
	}
	s.pending = nil
}

func (s *groqSession) call(ctx context.Context, req chatRequest) (usecase.Turn, error) {
	req.Messages = s.messages
	req.MaxCompletionTokens = agentMaxTokens
	req.ReasoningEffort = s.c.reasoningEffort("medium")
	msg, err := s.c.chat(ctx, req)
	for i := 0; i < toolRetries; i++ {
		var tf *toolUseFailed
		if !errors.As(err, &tf) {
			break
		}
		slog.Warn("groq rejected tool call, re-asking", "err", tf.msg)
		s.messages = append(s.messages, chatMessage{Role: "user", Content: strPtr("Your last tool call was rejected: " + tf.msg + ". Call it again with every required field.")})
		req.Messages = s.messages
		msg, err = s.c.chat(ctx, req)
	}
	if err != nil {
		return usecase.Turn{}, err
	}
	turn := turnOf(msg)
	history := chatMessage{Role: "assistant", Content: msg.Content, ToolCalls: msg.ToolCalls}
	if history.Content == nil && len(history.ToolCalls) == 0 {
		history.Content = strPtr("")
	}
	s.messages = append(s.messages, history)
	for _, tc := range msg.ToolCalls {
		s.pending = append(s.pending, tc.ID)
	}
	return turn, nil
}

// turnOf maps an assistant message to a Turn. Arguments must be a JSON object; anything else is passed on as a
// JSON string so the use case's strict decoding rejects it and tells the model (Go validation stays authoritative).
func turnOf(msg chatMessage) usecase.Turn {
	var turn usecase.Turn
	if msg.Content != nil {
		turn.Text = strings.TrimSpace(*msg.Content)
	}
	for _, tc := range msg.ToolCalls {
		turn.Calls = append(turn.Calls, usecase.ToolCall{ID: tc.ID, Name: tc.Function.Name, Input: argsOf(tc.Function.Arguments)})
	}
	return turn
}

func argsOf(args string) json.RawMessage {
	args = strings.TrimSpace(args)
	if args == "" || args == "null" {
		return json.RawMessage(`{}`)
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal([]byte(args), &obj) == nil && obj != nil {
		return json.RawMessage(args)
	}
	b, _ := json.Marshal(args)
	return b
}

func (s *groqSession) Close(bool) {}

// Answer implements usecase.Answerer: one tool-less live call. In replay mode it reports ErrLLMUnavailable
// so the use case answers from the stored verdict.
func (r *Router) Answer(ctx context.Context, system, prompt string) (string, error) {
	if r.Replaying() {
		return "", entity.Fail(entity.ErrLLMUnavailable, "Ask runs live only; replay mode is on.")
	}
	msg, err := r.live.chat(ctx, chatRequest{
		Messages:            []chatMessage{{Role: "system", Content: strPtr(system)}, {Role: "user", Content: strPtr(prompt)}},
		MaxCompletionTokens: askMaxTokens,
		ReasoningEffort:     r.live.reasoningEffort("low"),
	})
	if err != nil {
		return "", err
	}
	if msg.Content == nil {
		return "", nil
	}
	return strings.TrimSpace(*msg.Content), nil
}
