// Package mcp exposes the Fix-it tool registry as an MCP server (Streamable HTTP at /mcp/cases/{id}).
// It only adapts usecase.FixTools: write tools queue plan steps and never execute.
package mcp

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
)

// ToolOpener binds the Fix-it tools to one case (usecase.FixCase).
type ToolOpener interface {
	OpenTools(ctx context.Context, caseID string) (*usecase.FixTools, error)
}

// Handler serves one MCP server per session, bound to the {id} path value. Unknown,
// invalid or non-fixable cases get nil → 400 from the SDK.
func Handler(open ToolOpener, log *slog.Logger) http.Handler {
	return mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		tools, err := open.OpenTools(r.Context(), r.PathValue("id"))
		if err != nil {
			log.Info("mcp session refused", "case", r.PathValue("id"), "err", err)
			return nil
		}
		return NewServer(tools)
	}, nil)
}

// NewServer registers every Fix-it tool spec on a new server. Inputs are validated by the registry in Go.
func NewServer(tools *usecase.FixTools) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "verdict-fixit", Title: "Verdict Fix-it", Version: "1.0.0"}, nil)
	caps := map[string]any{}
	for _, c := range usecase.FixCapabilities() {
		caps[c.Tool] = c
	}
	no := false
	for _, spec := range usecase.FixToolSpecs() {
		schema := map[string]any{"type": "object", "properties": spec.Properties, "additionalProperties": false}
		if len(spec.Required) > 0 {
			schema["required"] = spec.Required
		}
		tool := &mcp.Tool{Name: spec.Name, Description: spec.Description, InputSchema: schema,
			// Writes only add plan steps: additive, closed world.
			Annotations: &mcp.ToolAnnotations{ReadOnlyHint: isRead(spec.Name), DestructiveHint: &no, OpenWorldHint: &no}}
		if c, ok := caps[spec.Name]; ok {
			tool.Meta = mcp.Meta{"capability": c}
		}
		s.AddTool(tool, handler(tools, spec.Name))
	}
	return s
}

func isRead(name string) bool {
	switch name {
	case usecase.ToolGetCase, usecase.ToolGetBilling, usecase.ToolGetEntitlements, usecase.ToolGetEmailLog:
		return true
	}
	return false
}

func handler(tools *usecase.FixTools, name string) mcp.ToolHandler {
	return func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		out, inputErr, err := tools.Run(ctx, name, req.Params.Arguments)
		res := &mcp.CallToolResult{}
		if err != nil {
			slog.ErrorContext(ctx, "mcp tool failed", "tool", name, "err", err)
			res.SetError(errInternal)
			return res, nil
		}
		if inputErr != nil {
			res.SetError(inputErr)
			return res, nil
		}
		body, err := json.Marshal(out.Output)
		if err != nil {
			return nil, err
		}
		res.Content = []mcp.Content{&mcp.TextContent{Text: string(body)}}
		return res, nil
	}
}

type internalError struct{}

func (internalError) Error() string { return "internal error; try again" }

var errInternal error = internalError{}
