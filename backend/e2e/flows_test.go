// Package e2e drives every endpoint in docs/api.md over HTTP and checks the JSON against the contract.
//
//	make test-db                         # in-process server on TEST_DATABASE_URL (replayed model, real Postgres)
//	E2E_BASE_URL=http://localhost:8080 go test ./e2e/   # against a running `make run` (make smoke)
//
// Both modes reset the demo state first and leave it reset at the end.
package e2e

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/adapter/llm"
	httpctl "github.com/serhiileniv/skelar-polytech-codefest/backend/internal/controller/http"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/repo/postgres"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/usecase"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/migrations"
)

type obj = map[string]any

var isoUTC = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`)

func baseURL(t *testing.T) string {
	if u := os.Getenv("E2E_BASE_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("set TEST_DATABASE_URL (make test-db) or E2E_BASE_URL (make smoke)")
	}
	ctx := context.Background()
	pool, err := postgres.Connect(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := postgres.Migrate(ctx, pool, migrations.FS, log); err != nil {
		t.Fatal(err)
	}
	_, file, _, _ := runtime.Caller(0)
	now := func() time.Time { return time.Now().UTC() }
	repo := postgres.NewCaseRepo(pool)
	model := llm.NewRouter(llm.Config{ReplayDir: filepath.Join(filepath.Dir(file), "..", "replay"), ForceReplay: true, Model: "replay"})
	srv := httptest.NewServer(httpctl.NewRouter(httpctl.Deps{
		DB: pool, Cases: usecase.NewReadCases(repo, repo), Actions: usecase.NewExecuteAction(repo, now),
		Replies: usecase.NewReplyToCase(repo, repo, now), Investigations: usecase.NewInvestigateCase(repo, model, now),
		Metrics: usecase.NewGetMetrics(repo), Reset: usecase.NewResetDemo(postgres.NewDemoStore(pool)),
		FrontendOrigins: []string{"http://localhost:3000"}, Log: log,
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

type client struct {
	t    *testing.T
	base string
}

func (c client) do(method, path string, body any) (int, []byte) {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		if s, ok := body.(string); ok {
			rd = strings.NewReader(s)
		} else {
			b, _ := json.Marshal(body)
			rd = bytes.NewReader(b)
		}
	}
	req, _ := http.NewRequest(method, c.base+path, rd)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, b
}

// json calls an endpoint, asserts the status and decodes the body.
func (c client) json(method, path string, body any, wantStatus int, out any) {
	c.t.Helper()
	status, b := c.do(method, path, body)
	if status != wantStatus {
		c.t.Fatalf("%s %s = %d, want %d: %s", method, path, status, wantStatus, b)
	}
	if out != nil {
		if err := json.Unmarshal(b, out); err != nil {
			c.t.Fatalf("%s %s: bad JSON %v: %s", method, path, err, b)
		}
	}
}

// apiError asserts the ApiError shape and code.
func (c client) apiError(method, path string, body any, wantStatus int, wantCode string) {
	c.t.Helper()
	var e obj
	c.json(method, path, body, wantStatus, &e)
	if e["code"] != wantCode || e["message"] == "" || e["message"] == nil {
		c.t.Fatalf("%s %s error body %v, want code %s", method, path, e, wantCode)
	}
}

type sseEvent struct {
	name string
	data obj
}

func (c client) investigate(caseID string) []sseEvent {
	c.t.Helper()
	req, _ := http.NewRequest(http.MethodPost, c.base+"/api/cases/"+caseID+"/investigate", nil)
	req.Header.Set("Accept", "text/event-stream")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		b, _ := io.ReadAll(res.Body)
		c.t.Fatalf("investigate %s = %d %s: %s", caseID, res.StatusCode, res.Header.Get("Content-Type"), b)
	}
	var evs []sseEvent
	var name string
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			var d obj
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &d); err != nil {
				c.t.Fatalf("bad SSE data for %s: %v", name, err)
			}
			evs = append(evs, sseEvent{name, d})
		}
	}
	return evs
}

// ---- contract shape checks ----

func requireKeys(t *testing.T, what string, o obj, keys ...string) {
	t.Helper()
	for _, k := range keys {
		if _, ok := o[k]; !ok {
			t.Fatalf("%s lacks %q: %v", what, k, o)
		}
	}
}

func requireTime(t *testing.T, what string, v any) {
	t.Helper()
	s, ok := v.(string)
	if !ok || !isoUTC.MatchString(s) {
		t.Fatalf("%s = %v, want ISO 8601 UTC", what, v)
	}
}

func requireArray(t *testing.T, what string, v any) []any {
	t.Helper()
	a, ok := v.([]any)
	if !ok {
		t.Fatalf("%s = %v (%T), want an array (never null)", what, v, v)
	}
	return a
}

func checkVerdict(t *testing.T, v obj) {
	t.Helper()
	requireKeys(t, "Verdict", v, "outcome", "modelOutcome", "downgraded", "validationNotes", "confidence",
		"customerGoal", "summary", "evidence", "replyDraft", "stepsUsed", "createdAt")
	requireArray(t, "verdict.validationNotes", v["validationNotes"])
	for _, e := range requireArray(t, "verdict.evidence", v["evidence"]) {
		requireKeys(t, "evidence", e.(obj), "id", "note")
	}
	requireTime(t, "verdict.createdAt", v["createdAt"])
	if v["outcome"] == "suspicious" {
		if _, ok := v["supportAction"]; ok {
			t.Fatal("a suspicious verdict must never carry supportAction")
		}
	}
}

func checkTechIssue(t *testing.T, ti obj) {
	t.Helper()
	requireKeys(t, "TechIssue", ti, "id", "signature", "title", "rootCause", "evidenceIds", "caseIds", "affectedCustomerIds", "status", "createdAt")
	for _, k := range []string{"evidenceIds", "caseIds", "affectedCustomerIds"} {
		requireArray(t, "techIssue."+k, ti[k])
	}
	requireTime(t, "techIssue.createdAt", ti["createdAt"])
}

func checkDetail(t *testing.T, d obj) {
	t.Helper()
	requireKeys(t, "CaseDetail", d, "case", "customer", "subscriptions", "payments", "entitlements", "audit")
	c := d["case"].(obj)
	requireKeys(t, "Case", c, "id", "customerId", "subject", "messages", "status", "createdAt", "verdict")
	requireTime(t, "case.createdAt", c["createdAt"])
	for _, m := range requireArray(t, "case.messages", c["messages"]) {
		requireKeys(t, "ChatMessage", m.(obj), "id", "from", "body", "at")
		requireTime(t, "message.at", m.(obj)["at"])
	}
	if v, ok := c["verdict"].(obj); ok {
		checkVerdict(t, v)
	}
	requireKeys(t, "Customer", d["customer"].(obj), "id", "name", "email", "platform", "appVersion", "country", "createdAt")
	for _, s := range requireArray(t, "subscriptions", d["subscriptions"]) {
		requireKeys(t, "Subscription", s.(obj), "id", "channel", "plan", "priceUsd", "status", "renewsAt", "canceledAt")
		if _, leaked := s.(obj)["customerId"]; leaked {
			t.Fatal("subscription must not expose customerId")
		}
	}
	for _, p := range requireArray(t, "payments", d["payments"]) {
		requireKeys(t, "Payment", p.(obj), "id", "subscriptionId", "channel", "amountUsd", "status", "at")
		requireTime(t, "payment.at", p.(obj)["at"])
	}
	for _, e := range requireArray(t, "entitlements", d["entitlements"]) {
		requireKeys(t, "Entitlement", e.(obj), "id", "accountEmail", "active", "paymentId", "grantedAt")
	}
	for _, a := range requireArray(t, "audit", d["audit"]) {
		requireKeys(t, "AuditEntry", a.(obj), "id", "caseId", "actor", "step", "detail", "at")
	}
}

func auditSteps(d obj) []string {
	var out []string
	for _, a := range d["audit"].([]any) {
		out = append(out, a.(obj)["step"].(string))
	}
	return out
}

// investigateExpect runs the stream, checks the event order and returns the verdict.
func investigateExpect(t *testing.T, c client, caseID, outcome string) obj {
	t.Helper()
	evs := c.investigate(caseID)
	if len(evs) < 4 || evs[0].name != "start" || evs[len(evs)-1].name != "done" || evs[len(evs)-2].name != "verdict" {
		t.Fatalf("%s stream order wrong: %v", caseID, names(evs))
	}
	requireKeys(t, "start", evs[0].data, "caseId", "replay", "model", "maxSteps")
	if evs[0].data["caseId"] != caseID || evs[0].data["maxSteps"] != float64(8) {
		t.Fatalf("start %v", evs[0].data)
	}
	steps, calls := 0, map[string]string{}
	for i, e := range evs[1 : len(evs)-2] {
		switch e.name {
		case "step":
			steps++
			if e.data["n"] != float64(steps) {
				t.Fatalf("step n = %v, want %d", e.data["n"], steps)
			}
		case "text":
			requireKeys(t, "text", e.data, "delta")
		case "tool_call":
			requireKeys(t, "tool_call", e.data, "callId", "tool", "input")
			calls[e.data["callId"].(string)] = e.data["tool"].(string)
		case "tool_result":
			requireKeys(t, "tool_result", e.data, "callId", "tool", "output", "ids")
			requireArray(t, "tool_result.ids", e.data["ids"])
			if calls[e.data["callId"].(string)] != e.data["tool"] {
				t.Fatalf("tool_result %v has no matching tool_call", e.data)
			}
			if evs[i].name != "tool_call" { // evs[i] is the event just before this one
				t.Fatalf("tool_result must follow its tool_call: %v", names(evs))
			}
		case "error":
			t.Fatalf("stream error: %v", e.data)
		default:
			t.Fatalf("unexpected event %q", e.name)
		}
	}
	if steps < 1 || steps > 8 {
		t.Fatalf("steps = %d", steps)
	}
	v := evs[len(evs)-2].data["verdict"].(obj)
	checkVerdict(t, v)
	if v["outcome"] != outcome || v["downgraded"] != false || v["stepsUsed"] != float64(steps) {
		t.Fatalf("%s verdict outcome=%v downgraded=%v steps=%v notes=%v, want %s", caseID, v["outcome"], v["downgraded"], v["stepsUsed"], v["validationNotes"], outcome)
	}
	return v
}

func names(evs []sseEvent) []string {
	var n []string
	for _, e := range evs {
		n = append(n, e.name)
	}
	return n
}

// ---- the flows ----

func TestDemoFlows(t *testing.T) {
	c := client{t, baseURL(t)}
	var reset obj
	c.json("DELETE", "/api/state", nil, 200, &reset)
	if reset["reset"] != true {
		t.Fatalf("reset = %v", reset)
	}
	t.Cleanup(func() { c.do("DELETE", "/api/state", nil) })

	t.Run("health", func(t *testing.T) {
		var h obj
		c.json("GET", "/health", nil, 200, &h)
		if h["status"] != "ok" {
			t.Fatalf("health %v", h)
		}
	})

	t.Run("inbox lists 7 open cases newest first", func(t *testing.T) {
		var items []obj
		c.json("GET", "/api/cases", nil, 200, &items)
		if len(items) != 7 {
			t.Fatalf("%d cases", len(items))
		}
		var prev string
		for _, it := range items {
			requireKeys(t, "CaseListItem", it, "id", "subject", "customerName", "preview", "status", "outcome", "createdAt")
			requireTime(t, "createdAt", it["createdAt"])
			if it["status"] != "open" || it["outcome"] != nil {
				t.Fatalf("fresh case %v", it)
			}
			if len([]rune(it["preview"].(string))) > 120 {
				t.Fatal("preview longer than 120 chars")
			}
			if prev != "" && it["createdAt"].(string) > prev {
				t.Fatal("not newest first")
			}
			prev = it["createdAt"].(string)
		}
		if items[0]["id"] != "case_107" {
			t.Fatalf("newest case = %v", items[0]["id"])
		}
	})

	t.Run("case detail is scoped to the case customer", func(t *testing.T) {
		var d obj
		c.json("GET", "/api/cases/case_103", nil, 200, &d)
		checkDetail(t, d)
		if d["customer"].(obj)["id"] != "cust_003" || len(d["payments"].([]any)) != 1 || d["case"].(obj)["verdict"] != nil {
			t.Fatalf("detail %v", d)
		}
	})

	t.Run("request errors use ApiError", func(t *testing.T) {
		c.apiError("GET", "/api/cases/case_999", nil, 404, "not_found")
		c.apiError("GET", "/api/cases/bad.id", nil, 400, "bad_request")
		c.apiError("POST", "/api/cases/case_999/investigate", nil, 404, "not_found")
		c.apiError("POST", "/api/cases/case_103/actions", `{"kind":"drop_tables"}`, 400, "bad_request")
		c.apiError("POST", "/api/cases/case_103/actions", `{"kind":"mark_resolved","admin":true}`, 400, "bad_request")
		c.apiError("POST", "/api/cases/case_103/actions", `not json`, 400, "bad_request")
		c.apiError("POST", "/api/cases/case_102/reply", obj{"body": "   "}, 400, "bad_request")
		c.apiError("POST", "/api/cases/case_102/reply", obj{"body": strings.Repeat("x", 3001)}, 400, "bad_request")
		c.apiError("GET", "/api/nope", nil, 404, "not_found")
	})

	t.Run("case_103 restore access", func(t *testing.T) {
		v := investigateExpect(t, c, "case_103", "support_can_fix")
		action := v["supportAction"].(obj)
		if action["type"] != "restore_access" || action["entitlementId"] != "ent_0003" {
			t.Fatalf("supportAction %v", action)
		}
		var res obj
		c.json("POST", "/api/cases/case_103/actions", obj{"kind": "support_action", "action": action}, 200, &res)
		if res["status"] != "executed" || res["rule"] != "R1" || res["message"] == "" {
			t.Fatalf("restore %v", res)
		}
		var d obj
		c.json("GET", "/api/cases/case_103", nil, 200, &d)
		checkDetail(t, d)
		ent := d["entitlements"].([]any)[0].(obj)
		if ent["active"] != true || ent["paymentId"] != "pay_0003" || d["case"].(obj)["status"] != "resolved" {
			t.Fatalf("after restore: ent %v status %v", ent, d["case"].(obj)["status"])
		}
		steps := auditSteps(d)
		for _, s := range []string{"tool:getChat", "tool:getBilling", "tool:getEntitlements", "tool:getErrorLogs", "verdict_submitted", "restore_access"} {
			if !slices.Contains(steps, s) {
				t.Fatalf("audit lacks %s: %v", s, steps)
			}
		}
		// Second click: access is already active → blocked by R1 and audited.
		c.json("POST", "/api/cases/case_103/actions", obj{"kind": "support_action", "action": action}, 200, &res)
		if res["status"] != "blocked" || res["rule"] != "R1" {
			t.Fatalf("second restore %v", res)
		}
	})

	t.Run("case_104 send to tech → one card with 38 customers, merged on repeat", func(t *testing.T) {
		// Not investigated yet → 409.
		c.apiError("POST", "/api/cases/case_104/actions", obj{"kind": "send_to_tech"}, 409, "conflict")
		v := investigateExpect(t, c, "case_104", "tech_team")
		if v["techIssue"].(obj)["signature"] != "cancel_not_synced" {
			t.Fatalf("techIssue %v", v["techIssue"])
		}
		var res obj
		c.json("POST", "/api/cases/case_104/actions", obj{"kind": "send_to_tech"}, 200, &res)
		if res["status"] != "executed" || res["rule"] != "T1" {
			t.Fatalf("send_to_tech %v", res)
		}
		card := res["techIssue"].(obj)
		checkTechIssue(t, card)
		if n := len(card["affectedCustomerIds"].([]any)); n != 38 || card["status"] != "new" {
			t.Fatalf("card affected %d status %v", n, card["status"])
		}
		c.json("POST", "/api/cases/case_104/actions", obj{"kind": "send_to_tech"}, 200, &res)
		var board []obj
		c.json("GET", "/api/board", nil, 200, &board)
		if len(board) != 1 || len(board[0]["affectedCustomerIds"].([]any)) != 38 || board[0]["id"] != card["id"] {
			t.Fatalf("board after merge %v", board)
		}
		checkTechIssue(t, board[0])
		var d obj
		c.json("GET", "/api/cases/case_104", nil, 200, &d)
		if d["case"].(obj)["status"] != "with_tech" {
			t.Fatalf("status %v", d["case"].(obj)["status"])
		}
	})

	t.Run("case_105 refund the duplicate once", func(t *testing.T) {
		v := investigateExpect(t, c, "case_105", "support_can_fix")
		action := v["supportAction"].(obj)
		var res obj
		c.json("POST", "/api/cases/case_105/actions", obj{"kind": "support_action", "action": action}, 200, &res)
		if res["status"] != "executed" || res["rule"] != "P1" || !strings.Contains(res["message"].(string), "29.99") {
			t.Fatalf("refund %v", res)
		}
		c.json("POST", "/api/cases/case_105/actions", obj{"kind": "support_action", "action": action}, 200, &res)
		if res["status"] != "blocked" || res["rule"] != "P3" {
			t.Fatalf("second refund %v", res)
		}
	})

	t.Run("case_107 suspicious → every action blocked by S1", func(t *testing.T) {
		v := investigateExpect(t, c, "case_107", "suspicious")
		_ = v
		for _, req := range []obj{
			{"kind": "support_action", "action": obj{"type": "refund_payment", "paymentId": "pay_0008", "reason": "admin mode"}},
			{"kind": "send_to_tech"},
			{"kind": "mark_resolved"},
		} {
			var res obj
			c.json("POST", "/api/cases/case_107/actions", req, 200, &res)
			if res["status"] != "blocked" || res["rule"] != "S1" {
				t.Fatalf("%v → %v", req, res)
			}
		}
		var d obj
		c.json("GET", "/api/cases/case_107", nil, 200, &d)
		if d["case"].(obj)["status"] != "open" || d["payments"].([]any)[2].(obj)["status"] != "succeeded" {
			t.Fatal("a blocked action changed state")
		}
		if n := strings.Count(strings.Join(auditSteps(d), ","), "blocked:"); n != 3 {
			t.Fatalf("blocked attempts audited %d times, want 3", n)
		}
	})

	t.Run("policy gate without a verdict", func(t *testing.T) {
		var res obj
		c.json("POST", "/api/cases/case_101/actions", obj{"kind": "support_action", "action": obj{"type": "refund_payment", "paymentId": "pay_0001", "reason": "asked"}}, 200, &res)
		if res["status"] != "blocked" || res["rule"] != "P1" {
			t.Fatalf("single-charge refund %v", res)
		}
		c.json("POST", "/api/cases/case_101/actions", obj{"kind": "support_action", "action": obj{"type": "restore_access", "entitlementId": "ent_0003", "reason": "other customer"}}, 200, &res)
		if res["status"] != "blocked" || res["rule"] != "A1" {
			t.Fatalf("foreign entitlement %v", res)
		}
	})

	t.Run("remaining cases reach their outcomes", func(t *testing.T) {
		for caseID, outcome := range map[string]string{"case_101": "user_can_fix", "case_102": "user_can_fix", "case_106": "need_more_info"} {
			v := investigateExpect(t, c, caseID, outcome)
			if outcome == "user_can_fix" && len(v["instructionSteps"].([]any)) == 0 {
				t.Fatalf("%s has no instruction steps", caseID)
			}
			if outcome == "need_more_info" && v["clarifyingQuestion"] == "" {
				t.Fatalf("%s has no clarifying question", caseID)
			}
		}
	})

	t.Run("reply appends a support message and waits for the customer", func(t *testing.T) {
		var d obj
		c.json("POST", "/api/cases/case_102/reply", obj{"body": "  Please check your spam folder.  "}, 200, &d)
		checkDetail(t, d)
		msgs := d["case"].(obj)["messages"].([]any)
		last := msgs[len(msgs)-1].(obj)
		if last["from"] != "support" || last["body"] != "Please check your spam folder." || d["case"].(obj)["status"] != "waiting_customer" {
			t.Fatalf("after reply: %v status %v", last, d["case"].(obj)["status"])
		}
		if !slices.Contains(auditSteps(d), "reply") {
			t.Fatal("reply not audited")
		}
	})

	t.Run("mark resolved", func(t *testing.T) {
		var res obj
		c.json("POST", "/api/cases/case_106/actions", obj{"kind": "mark_resolved"}, 200, &res)
		if res["status"] != "executed" || res["rule"] != "-" {
			t.Fatalf("resolve %v", res)
		}
	})

	t.Run("metrics reflect everything above", func(t *testing.T) {
		var m obj
		c.json("GET", "/api/metrics", nil, 200, &m)
		requireKeys(t, "Metrics", m, "totalCases", "investigated", "byOutcome", "keptFromTech", "downgraded", "avgSteps", "actions", "eval")
		by := m["byOutcome"].(obj)
		for _, o := range []string{"user_can_fix", "support_can_fix", "tech_team", "need_more_info", "suspicious"} {
			if _, ok := by[o]; !ok {
				t.Fatalf("byOutcome lacks %s", o)
			}
		}
		a := m["actions"].(obj)
		if m["totalCases"] != float64(7) || m["investigated"] != float64(7) || m["keptFromTech"] != float64(6) || m["downgraded"] != float64(0) {
			t.Fatalf("metrics %v", m)
		}
		// executed: restore, send_to_tech ×2, refund, mark_resolved = 5; blocked: R1, P3, S1×3, P1, A1 = 7
		if a["executed"] != float64(5) || a["blocked"] != float64(7) {
			t.Fatalf("actions %v", a)
		}
	})

	t.Run("reset restores the fresh world", func(t *testing.T) {
		c.json("DELETE", "/api/state", nil, 200, nil)
		var items []obj
		c.json("GET", "/api/cases", nil, 200, &items)
		for _, it := range items {
			if it["status"] != "open" || it["outcome"] != nil {
				t.Fatalf("after reset %v", it)
			}
		}
		var board []obj
		c.json("GET", "/api/board", nil, 200, &board)
		if len(board) != 0 {
			t.Fatalf("board after reset %v", board)
		}
	})
}

func TestCORSForFrontend(t *testing.T) {
	base := baseURL(t)
	req, _ := http.NewRequest(http.MethodOptions, base+"/api/cases/case_103/investigate", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "POST")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 204 || res.Header.Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Fatalf("preflight %d %v", res.StatusCode, res.Header)
	}
}
