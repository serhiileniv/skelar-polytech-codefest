package mcp

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/repo/memory"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/seed"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
)

// worldStore serves the seed world read-only; methods Fix-it does not use panic (nil embedded interface).
type worldStore struct {
	usecase.InvestigationStore
	w entity.World
}

func only[T any](rows []T, keep func(T) bool) []T {
	out := []T{}
	for _, r := range rows {
		if keep(r) {
			out = append(out, r)
		}
	}
	return out
}

func (s worldStore) Case(_ context.Context, id string) (entity.Case, error) {
	for _, c := range s.w.Cases {
		if c.ID == id {
			return c, nil
		}
	}
	return entity.Case{}, entity.Fail(entity.ErrNotFound, "no case")
}
func (s worldStore) Customer(_ context.Context, id string) (entity.Customer, error) {
	return only(s.w.Customers, func(c entity.Customer) bool { return c.ID == id })[0], nil
}
func (s worldStore) Subscriptions(_ context.Context, id string) ([]entity.Subscription, error) {
	return only(s.w.Subscriptions, func(x entity.Subscription) bool { return x.CustomerID == id }), nil
}
func (s worldStore) Payments(_ context.Context, id string) ([]entity.Payment, error) {
	return only(s.w.Payments, func(x entity.Payment) bool { return x.CustomerID == id }), nil
}
func (s worldStore) Entitlements(_ context.Context, id string) ([]entity.Entitlement, error) {
	return only(s.w.Entitlements, func(x entity.Entitlement) bool { return x.CustomerID == id }), nil
}
func (s worldStore) Events(_ context.Context, id string) ([]entity.SessionEvent, error) {
	return only(s.w.Events, func(x entity.SessionEvent) bool { return x.CustomerID == id }), nil
}
func (s worldStore) Emails(_ context.Context, id string) ([]entity.EmailLog, error) {
	return only(s.w.Emails, func(x entity.EmailLog) bool { return x.CustomerID == id }), nil
}
func (s worldStore) Errors(_ context.Context, id string) ([]entity.ErrorLog, error) {
	return only(s.w.Errors, func(x entity.ErrorLog) bool { return x.CustomerID == id }), nil
}
func (s worldStore) ListTechIssues(context.Context) ([]entity.TechIssue, error) { return nil, nil }
func (s worldStore) AppendAudit(context.Context, entity.AuditEntry) error       { return nil }

func TestMCPSmoke(t *testing.T) {
	ctx := context.Background()
	w := seed.World()
	w.Cases[0].Verdict = &entity.Verdict{Outcome: entity.OutcomeUserCanFix} // case_101
	fixes := usecase.NewFixCase(worldStore{w: w}, nil, memory.NewFixPlans(), func() time.Time { return seed.Now })
	tools, err := fixes.OpenTools(ctx, "case_101")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixes.OpenTools(ctx, "case_104"); err == nil {
		t.Fatal("case without a fixable verdict must be refused")
	}

	serverT, clientT := mcp.NewInMemoryTransports()
	if _, err := NewServer(tools).Connect(ctx, serverT, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "smoke", Version: "0"}, nil).Connect(ctx, clientT, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()

	list, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Tools) != 12 {
		t.Fatalf("got %d tools, want 12 (6 reads, 5 writes, noteManualStep)", len(list.Tools))
	}
	for _, tool := range list.Tools {
		if tool.Name == usecase.ToolSubmitFixPlan {
			t.Fatal("submitFixPlan is loop-only")
		}
	}

	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: usecase.ToolCancelSubscription,
		Arguments: map[string]any{"subscriptionId": "sub_0001", "reason": "App deleted, still billed"}})
	if err != nil || res.IsError {
		t.Fatalf("call: %v %+v", err, res)
	}
	text := res.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(text, `"queued":true`) || !strings.Contains(text, `"wouldBe":"executed"`) {
		t.Fatalf("result %s", text)
	}
	for _, s := range w.Subscriptions {
		if s.ID == "sub_0001" && s.Status != entity.SubscriptionActive {
			t.Fatal("MCP write executed")
		}
	}

	bad, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: usecase.ToolRestoreAccess, Arguments: map[string]any{"reason": "no id"}})
	if err != nil || !bad.IsError {
		t.Fatalf("invalid input must be a tool error: %v %+v", err, bad)
	}
}
