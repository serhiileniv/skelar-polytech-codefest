package usecase

import (
	"context"
	"encoding/json"
)

// The agent model port. The Anthropic adapter and the replay adapter implement it (internal/adapter/llm).

// ToolSpec describes one tool to the model.
type ToolSpec struct {
	Name        string
	Description string
	Properties  map[string]any
	Required    []string
}

// ToolCall is one tool_use the model emitted.
type ToolCall struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

// ToolResult answers one ToolCall.
type ToolResult struct {
	CallID  string
	Content string // JSON
	IsError bool
}

// Turn is one model response: an optional sentence of reasoning plus tool calls.
type Turn struct {
	Text  string     `json:"text"`
	Calls []ToolCall `json:"calls"`
}

// ModelInfo is reported in the SSE start event.
type ModelInfo struct {
	Model  string
	Replay bool
}

// AgentSession is one conversation. It owns the provider's native history (e.g. thinking blocks).
type AgentSession interface {
	// Next sends the previous turn's tool results (none on the first call) and returns the next turn.
	// finalStep restricts the model to submitVerdict.
	Next(ctx context.Context, results []ToolResult, finalStep bool) (Turn, error)
	// Close ends the session; succeeded=true when a verdict was stored (recorders save then).
	Close(succeeded bool)
}

// AgentModel opens sessions. Start returns entity.ErrLLMUnavailable when there is neither an API key nor a recording.
type AgentModel interface {
	Start(ctx context.Context, caseID, system, prompt string, tools []ToolSpec) (AgentSession, ModelInfo, error)
}
