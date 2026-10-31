package entity

import (
	"fmt"
	"time"
)

// Policy rule ids (docs/api.md → ActionResult.rule). Port of src/lib/policy/gate.ts.
const (
	RuleOwnRecords     = "A1" // actions only target records of the case's own customer
	RuleRestore        = "R1" // restore only for a paid customer whose access is not active
	RuleDuplicate      = "P1" // refund only a duplicate of another succeeded payment within 5 min
	RuleRefundLimit    = "P2" // refunds above $50 are never issued by support
	RuleRefundOnce     = "P3" // a payment can be refunded only once
	RuleSuspicious     = "S1" // no actions on cases flagged suspicious
	RuleTechBoard      = "T1" // send to tech
	RuleNone           = "-"
	MaxRefundUSD       = 50.0
	duplicateRefundGap = 5 * time.Minute
)

// GateResult is the deterministic decision for one support action.
type GateResult struct {
	Allowed bool
	Rule    string
	Reason  string
}

// CustomerRecords is the case customer's mutable records, as the gate sees them.
type CustomerRecords struct {
	Entitlements  []Entitlement
	Payments      []Payment
	Subscriptions []Subscription // C1
	Events        []SessionEvent // E1
	Emails        []EmailLog     // E1
	Now           time.Time      // clock for time-window rules (E1); set by the use case
}

// EvaluateAction runs the policy gate on a support action, regardless of what the AI proposed.
// caseOutcome is the case's current verdict outcome ("" when not investigated).
func EvaluateAction(a SupportAction, caseOutcome Outcome, recs CustomerRecords) GateResult {
	if caseOutcome == OutcomeSuspicious {
		return GateResult{false, RuleSuspicious, "Case is flagged as suspicious; no actions allowed."}
	}
	switch a.Type {
	case ActionRestoreAccess:
		var ent *Entitlement
		for i := range recs.Entitlements {
			if recs.Entitlements[i].ID == a.EntitlementID {
				ent = &recs.Entitlements[i]
			}
		}
		if ent == nil {
			return GateResult{false, RuleOwnRecords, fmt.Sprintf("Entitlement %s does not belong to this customer.", a.EntitlementID)}
		}
		if ent.Active {
			return GateResult{false, RuleRestore, fmt.Sprintf("Entitlement %s is already active.", ent.ID)}
		}
		if _, ok := LatestSucceededPayment(recs.Payments); !ok {
			return GateResult{false, RuleRestore, "No succeeded payment backs this access."}
		}
		return GateResult{true, RuleRestore, "Paid customer without active access."}

	case ActionRefundPayment:
		var pay *Payment
		for i := range recs.Payments {
			if recs.Payments[i].ID == a.PaymentID {
				pay = &recs.Payments[i]
			}
		}
		if pay == nil {
			return GateResult{false, RuleOwnRecords, fmt.Sprintf("Payment %s does not belong to this customer.", a.PaymentID)}
		}
		if pay.Status == PaymentRefunded {
			return GateResult{false, RuleRefundOnce, fmt.Sprintf("Payment %s is already refunded.", pay.ID)}
		}
		if pay.AmountUSD > MaxRefundUSD {
			return GateResult{false, RuleRefundLimit, fmt.Sprintf("Refunds over $%.0f need a manager ($%.2f requested).", MaxRefundUSD, pay.AmountUSD)}
		}
		for _, p := range recs.Payments {
			gap := p.At.Sub(pay.At)
			if gap < 0 {
				gap = -gap
			}
			if p.ID != pay.ID && p.SubscriptionID == pay.SubscriptionID && p.Status == PaymentSucceeded && gap <= duplicateRefundGap {
				return GateResult{true, RuleDuplicate, fmt.Sprintf("Duplicates %s on the same subscription.", p.ID)}
			}
		}
		return GateResult{false, RuleDuplicate, fmt.Sprintf("Payment %s is not a duplicate charge; support only refunds duplicates.", pay.ID)}

	case ActionCancelSubscription:
		return evaluateCancel(a, recs)
	case ActionSendMagicLink:
		return evaluateMagicLink(recs)
	}
	return GateResult{false, RuleOwnRecords, "Unknown action."}
}

// LatestSucceededPayment is the payment that backs restored access.
func LatestSucceededPayment(payments []Payment) (Payment, bool) {
	var best Payment
	found := false
	for _, p := range payments {
		if p.Status == PaymentSucceeded && (!found || p.At.After(best.At)) {
			best, found = p, true
		}
	}
	return best, found
}
