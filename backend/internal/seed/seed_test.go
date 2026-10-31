package seed

import (
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// Port of src/lib/domain/seed.test.ts (feat/verdict-backbone).

var w = World()

func custRange(from, to int) []string {
	var ids []string
	for n := from; n <= to; n++ {
		ids = append(ids, fmt.Sprintf("cust_%03d", n))
	}
	return ids
}

func subsOf(id string) []entity.Subscription {
	return filter(w.Subscriptions, func(s entity.Subscription) bool { return s.CustomerID == id })
}
func paysOf(id string) []entity.Payment {
	return filter(w.Payments, func(p entity.Payment) bool { return p.CustomerID == id })
}
func entsOf(id string) []entity.Entitlement {
	return filter(w.Entitlements, func(e entity.Entitlement) bool { return e.CustomerID == id })
}
func evsOf(id string) []entity.SessionEvent {
	return filter(w.Events, func(e entity.SessionEvent) bool { return e.CustomerID == id })
}
func errsOf(id string) []entity.ErrorLog {
	return filter(w.Errors, func(e entity.ErrorLog) bool { return e.CustomerID == id })
}
func mailsOf(id string) []entity.EmailLog {
	return filter(w.Emails, func(m entity.EmailLog) bool { return m.CustomerID == id })
}
func filter[T any](rows []T, keep func(T) bool) []T {
	var out []T
	for _, r := range rows {
		if keep(r) {
			out = append(out, r)
		}
	}
	return out
}
func webSub(id string) entity.Subscription {
	for _, s := range subsOf(id) {
		if s.Channel == entity.ChannelWeb {
			return s
		}
	}
	panic("no web sub for " + id)
}
func payment(id string) entity.Payment {
	for _, p := range w.Payments {
		if p.ID == id {
			return p
		}
	}
	panic("no payment " + id)
}

// cancelNotSyncedHits mirrors the TS detector: web cancel followed by a succeeded App Store charge within 60 min.
// The real detector lands in entity with BE4; this keeps the seed honest until then.
func cancelNotSyncedHits(w entity.World) []string {
	var hits []string
	for _, s := range w.Subscriptions {
		if s.Channel != entity.ChannelWeb || s.Status != entity.SubscriptionCanceled || s.CanceledAt == nil {
			continue
		}
		for _, p := range w.Payments {
			d := p.At.Sub(*s.CanceledAt)
			if p.CustomerID == s.CustomerID && p.Channel == entity.ChannelAppStore && p.Status == entity.PaymentSucceeded && d > 0 && d <= time.Hour {
				hits = append(hits, s.CustomerID)
				break
			}
		}
	}
	slices.Sort(hits)
	return slices.Compact(hits)
}

func TestDeterministic(t *testing.T) {
	if !reflect.DeepEqual(World(), World()) {
		t.Fatal("World() is not deterministic")
	}
	if !w.Now.Equal(Now) {
		t.Fatalf("now = %v", w.Now)
	}
}

func TestCounts(t *testing.T) {
	tests := []struct {
		name string
		got  int
		want int
	}{
		{"customers", len(w.Customers), 91},
		{"cases", len(w.Cases), 7},
		{"help articles", len(w.Help), 6},
		{"cancel_not_synced customers", len(cancelNotSyncedHits(w)), 38},
	}
	for _, tt := range tests {
		if tt.got != tt.want {
			t.Errorf("%s = %d, want %d", tt.name, tt.got, tt.want)
		}
	}
}

func TestUniquePrefixedIDs(t *testing.T) {
	ids := func(n int, get func(int) string) []string {
		out := make([]string, n)
		for i := range out {
			out[i] = get(i)
		}
		return out
	}
	var msgs []string
	for _, c := range w.Cases {
		for _, m := range c.Messages {
			msgs = append(msgs, m.ID)
		}
	}
	tests := []struct {
		prefix string
		ids    []string
	}{
		{"cust_", ids(len(w.Customers), func(i int) string { return w.Customers[i].ID })},
		{"sub_", ids(len(w.Subscriptions), func(i int) string { return w.Subscriptions[i].ID })},
		{"pay_", ids(len(w.Payments), func(i int) string { return w.Payments[i].ID })},
		{"ent_", ids(len(w.Entitlements), func(i int) string { return w.Entitlements[i].ID })},
		{"ev_", ids(len(w.Events), func(i int) string { return w.Events[i].ID })},
		{"err_", ids(len(w.Errors), func(i int) string { return w.Errors[i].ID })},
		{"mail_", ids(len(w.Emails), func(i int) string { return w.Emails[i].ID })},
		{"help_", ids(len(w.Help), func(i int) string { return w.Help[i].ID })},
		{"case_", ids(len(w.Cases), func(i int) string { return w.Cases[i].ID })},
		{"msg_", msgs},
	}
	for _, tt := range tests {
		t.Run(tt.prefix, func(t *testing.T) {
			seen := map[string]bool{}
			for _, id := range tt.ids {
				if !strings.HasPrefix(id, tt.prefix) {
					t.Errorf("id %q lacks prefix", id)
				}
				if seen[id] {
					t.Errorf("duplicate id %q", id)
				}
				seen[id] = true
			}
		})
	}
}

func TestReferentialIntegrity(t *testing.T) {
	custs, subs, pays := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, c := range w.Customers {
		custs[c.ID] = true
	}
	for _, s := range w.Subscriptions {
		subs[s.ID] = true
		if !custs[s.CustomerID] {
			t.Errorf("%s → unknown customer", s.ID)
		}
	}
	for _, p := range w.Payments {
		pays[p.ID] = true
		if !custs[p.CustomerID] || !subs[p.SubscriptionID] {
			t.Errorf("%s → unknown customer/subscription", p.ID)
		}
	}
	for _, e := range w.Entitlements {
		if !custs[e.CustomerID] || (e.PaymentID != nil && !pays[*e.PaymentID]) {
			t.Errorf("%s → unknown customer/payment", e.ID)
		}
	}
	for _, c := range w.Cases {
		if !custs[c.CustomerID] {
			t.Errorf("%s → unknown customer", c.ID)
		}
	}
}

func TestCasesOpenAndFresh(t *testing.T) {
	want := [][2]string{
		{"case_101", "cust_001"}, {"case_102", "cust_002"}, {"case_103", "cust_003"}, {"case_104", "cust_004"},
		{"case_105", "cust_005"}, {"case_106", "cust_006"}, {"case_107", "cust_007"},
	}
	for i, c := range w.Cases {
		if [2]string{c.ID, c.CustomerID} != want[i] {
			t.Errorf("case %d = %s/%s, want %v", i, c.ID, c.CustomerID, want[i])
		}
		if c.Status != entity.CaseOpen || c.Verdict != nil {
			t.Errorf("%s: status %s verdict %v", c.ID, c.Status, c.Verdict)
		}
		if n := len(c.Messages); n < 1 || n > 2 {
			t.Errorf("%s: %d messages", c.ID, n)
		}
		for _, m := range c.Messages {
			if m.From != entity.FromCustomer {
				t.Errorf("%s: message from %s", c.ID, m.From)
			}
		}
		if !c.CreatedAt.Equal(c.Messages[0].At) {
			t.Errorf("%s: createdAt != first message", c.ID)
		}
	}
}

func TestPricesAndNothingAfterNow(t *testing.T) {
	for _, p := range w.Payments {
		if p.AmountUSD != PriceMonthly && p.AmountUSD != PriceYearly {
			t.Errorf("%s amount %v", p.ID, p.AmountUSD)
		}
		if p.At.After(Now) {
			t.Errorf("payment %s after now", p.ID)
		}
	}
	for _, e := range w.Events {
		if e.At.After(Now) {
			t.Errorf("event %s after now", e.ID)
		}
	}
	for _, e := range w.Errors {
		if e.At.After(Now) {
			t.Errorf("error %s after now", e.ID)
		}
	}
	for _, m := range w.Emails {
		if m.At.After(Now) {
			t.Errorf("email %s after now", m.ID)
		}
	}
}

func TestCase101DeletedAppStillSubscribed(t *testing.T) {
	id := "cust_001"
	if w.Customers[0].Name != "Emma Carter" {
		t.Fatalf("name %s", w.Customers[0].Name)
	}
	subs := subsOf(id)
	if len(subs) != 1 || subs[0].Channel != entity.ChannelAppStore || subs[0].Status != entity.SubscriptionActive || subs[0].CanceledAt != nil {
		t.Fatalf("subs %+v", subs)
	}
	var deleted *entity.SessionEvent
	for _, e := range evsOf(id) {
		if strings.Contains(e.Type, "cancel") {
			t.Errorf("unexpected cancel event %s", e.ID)
		}
		if e.Type == "app_deleted" && e.Source == entity.PlatformIOS {
			deleted = &e
		}
	}
	if deleted == nil {
		t.Fatal("no app_deleted event")
	}
	renewed := slices.ContainsFunc(paysOf(id), func(p entity.Payment) bool {
		return p.Status == entity.PaymentSucceeded && p.At.After(deleted.At)
	})
	if !renewed {
		t.Error("no renewal after app_deleted")
	}
	steps := strings.Join(Help()[0].Steps, " ")
	for _, s := range []string{"Settings", "Apple ID", "Subscriptions", "PawPlan", "Cancel Subscription"} {
		if !strings.Contains(steps, s) {
			t.Errorf("help_cancel_ios lacks %q", s)
		}
	}
}

func TestCase102ResetEmailDelivered(t *testing.T) {
	id := "cust_002"
	email := w.Customers[1].Email
	resets := filter(evsOf(id), func(e entity.SessionEvent) bool { return e.Type == "password_reset_requested" })
	mails := filter(mailsOf(id), func(m entity.EmailLog) bool { return m.Template == "password_reset" })
	if len(resets) != 3 || len(mails) != 3 {
		t.Fatalf("resets %d mails %d", len(resets), len(mails))
	}
	for _, m := range mails {
		if m.Status != "delivered" || m.To != email {
			t.Errorf("mail %+v", m)
		}
	}
	if len(errsOf(id)) != 0 {
		t.Error("cust_002 has errors")
	}
	steps := strings.Join(Help()[1].Steps, " ")
	for _, s := range []string{"Spam", "Promotions", `"PawPlan"`, "contacts"} {
		if !strings.Contains(steps, s) {
			t.Errorf("help_reset_email lacks %q", s)
		}
	}
}

func TestCase103GrantFailed(t *testing.T) {
	id := "cust_003"
	p := payment("pay_0003")
	if p.CustomerID != id || p.Status != entity.PaymentSucceeded || Now.Sub(p.At) != time.Hour {
		t.Fatalf("pay_0003 %+v", p)
	}
	ents := entsOf(id)
	if len(ents) != 1 || ents[0].ID != "ent_0003" || ents[0].Active || ents[0].PaymentID != nil || ents[0].GrantedAt != nil {
		t.Fatalf("ents %+v", ents)
	}
	errs := errsOf(id)
	if len(errs) != 1 || errs[0].Service != "entitlements" || errs[0].Code != "GRANT_FAILED" {
		t.Fatalf("errs %+v", errs)
	}
	if d := errs[0].At.Sub(p.At); d <= 0 || d >= time.Minute {
		t.Errorf("GRANT_FAILED %v after payment", d)
	}
}

func TestCase104CancelNotSynced(t *testing.T) {
	id := "cust_004"
	if w.Customers[3].Name != "Liam Novak" {
		t.Fatalf("name %s", w.Customers[3].Name)
	}
	web := webSub(id)
	var app entity.Subscription
	for _, s := range subsOf(id) {
		if s.Channel == entity.ChannelAppStore {
			app = s
		}
	}
	if web.Status != entity.SubscriptionCanceled || app.Status != entity.SubscriptionActive {
		t.Fatalf("web %s app %s", web.Status, app.Status)
	}
	T := *web.CanceledAt
	cancel := filter(evsOf(id), func(e entity.SessionEvent) bool { return e.Type == "cancel_clicked" })
	if len(cancel) != 1 || cancel[0].Source != entity.PlatformWeb || !cancel[0].At.Equal(T) || cancel[0].ID != "ev_0006" {
		t.Errorf("cancel_clicked %+v", cancel)
	}
	charge := filter(paysOf(id), func(p entity.Payment) bool {
		return p.SubscriptionID == app.ID && p.Status == entity.PaymentSucceeded
	})
	if len(charge) != 1 || charge[0].At.Sub(T) != 3*time.Minute || charge[0].ID != "pay_0004" {
		t.Errorf("charge %+v", charge)
	}
	errs := errsOf(id)
	if len(errs) != 1 || errs[0].Code != "CANCEL_SYNC_TIMEOUT" || errs[0].Service != "billing" || !errs[0].At.Equal(T) || errs[0].ID != "err_0002" {
		t.Errorf("errs %+v", errs)
	}
}

func TestCase105DuplicateCharge(t *testing.T) {
	a, b := payment("pay_0005"), payment("pay_0006")
	if a.CustomerID != "cust_005" || b.CustomerID != "cust_005" || a.SubscriptionID != b.SubscriptionID ||
		a.Status != entity.PaymentSucceeded || b.Status != entity.PaymentSucceeded || b.At.Sub(a.At) != 40*time.Second {
		t.Fatalf("a %+v b %+v", a, b)
	}
	errs := errsOf("cust_005")
	if len(errs) != 1 || errs[0].Code != "IDEMPOTENCY_KEY_MISSING" {
		t.Errorf("errs %+v", errs)
	}
}

func TestHealthyAccounts(t *testing.T) {
	for _, id := range []string{"cust_006", "cust_007"} {
		t.Run(id, func(t *testing.T) {
			for _, s := range subsOf(id) {
				if s.Status != entity.SubscriptionActive {
					t.Errorf("sub %s %s", s.ID, s.Status)
				}
			}
			for _, e := range entsOf(id) {
				if !e.Active {
					t.Errorf("ent %s inactive", e.ID)
				}
			}
			if len(errsOf(id)) != 0 {
				t.Error("has errors")
			}
			evs := evsOf(id)
			if len(evs) == 0 {
				t.Error("no events")
			}
			for _, e := range evs {
				if strings.Contains(e.Type, "cancel") {
					t.Errorf("cancel event %s", e.ID)
				}
			}
		})
	}
	if got := w.Cases[6].Messages[0].Body; got != InjectionText {
		t.Errorf("case_107 body = %q", got)
	}
}

func TestCancelNotSyncedPopulation(t *testing.T) {
	want := append([]string{"cust_004"}, custRange(48, 84)...)
	if got := cancelNotSyncedHits(w); !slices.Equal(got, want) {
		t.Fatalf("hits = %v", got)
	}
	caseCustomers := map[string]bool{}
	for _, c := range w.Cases {
		caseCustomers[c.CustomerID] = true
	}
	for _, id := range custRange(48, 84) {
		if caseCustomers[id] {
			t.Errorf("%s has a case", id)
		}
		if Now.Sub(*webSub(id).CanceledAt) > 6*24*time.Hour {
			t.Errorf("%s cancelled more than 6 days ago", id)
		}
		if errs := errsOf(id); len(errs) != 1 || errs[0].Code != "CANCEL_SYNC_TIMEOUT" {
			t.Errorf("%s errs %+v", id, errs)
		}
	}
}

func TestCancelNotSyncedLookAlikes(t *testing.T) {
	appCharges := func(id string) []entity.Payment {
		return filter(paysOf(id), func(p entity.Payment) bool { return p.Channel == entity.ChannelAppStore })
	}
	tests := []struct {
		name  string
		ids   []string
		check func(t *testing.T, id string)
	}{
		{"refunded", custRange(85, 87), func(t *testing.T, id string) {
			if !slices.ContainsFunc(appCharges(id), func(p entity.Payment) bool { return p.Status == entity.PaymentRefunded }) {
				t.Errorf("%s has no refunded app_store charge", id)
			}
		}},
		{"charged before cancel", custRange(88, 89), func(t *testing.T, id string) {
			for _, p := range appCharges(id) {
				if !p.At.Before(*webSub(id).CanceledAt) {
					t.Errorf("%s charge %s not before cancel", id, p.ID)
				}
			}
		}},
		{"charged 20 days later", custRange(90, 91), func(t *testing.T, id string) {
			if d := appCharges(id)[0].At.Sub(*webSub(id).CanceledAt); d != 20*24*time.Hour {
				t.Errorf("%s charge %v after cancel", id, d)
			}
		}},
	}
	hits := cancelNotSyncedHits(w)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, id := range tt.ids {
				if slices.Contains(hits, id) {
					t.Errorf("%s matches cancel_not_synced", id)
				}
				tt.check(t, id)
			}
		})
	}
}
