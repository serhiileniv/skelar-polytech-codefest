package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// ExecuteAction is the single entry point for human-clicked actions (POST /api/cases/{id}/actions).
// Support actions pass the policy gate; the gate decision, the change and the audit row commit in one transaction.
// A refusal is not an error: it is ActionResult{status: blocked} and is audited too.
type ExecuteAction struct {
	store CaseStore
	now   Clock
}

func NewExecuteAction(store CaseStore, now Clock) *ExecuteAction {
	return &ExecuteAction{store: store, now: now}
}

func (u *ExecuteAction) Execute(ctx context.Context, caseID string, req entity.ActionRequest) (entity.ActionResult, error) {
	if err := checkID(caseID); err != nil {
		return entity.ActionResult{}, err
	}
	if err := req.Check(); err != nil {
		return entity.ActionResult{}, err
	}
	var result entity.ActionResult
	err := u.store.InTx(ctx, func(tx CaseTx) error {
		r, err := u.decideAndApply(ctx, tx, caseID, req)
		result = r
		return err
	})
	if errors.Is(err, errBlocked) {
		// Blocked attempts are recorded in their own transaction so the refusal survives the rollback.
		err = u.store.InTx(ctx, func(tx CaseTx) error {
			return tx.AppendAudit(ctx, entity.AuditEntry{CaseID: caseID, Actor: entity.ActorSystem,
				Step: "blocked:" + req.Name(), Detail: fmt.Sprintf("%s %s", result.Rule, result.Message), At: u.now()})
		})
	}
	return result, err
}

// errBlocked rolls back anything the decision touched; the result is still returned to the caller.
var errBlocked = errors.New("blocked by policy")

func (u *ExecuteAction) decideAndApply(ctx context.Context, tx CaseTx, caseID string, req entity.ActionRequest) (entity.ActionResult, error) {
	kase, err := tx.LockCase(ctx, caseID)
	if err != nil {
		return entity.ActionResult{}, err
	}
	var outcome entity.Outcome
	if kase.Verdict != nil {
		outcome = kase.Verdict.Outcome
	}
	now := u.now()
	blocked := func(rule, msg string) (entity.ActionResult, error) {
		return entity.ActionResult{Status: "blocked", Message: msg, Rule: rule}, errBlocked
	}
	executed := func(rule, msg string, techIssue *entity.TechIssue) (entity.ActionResult, error) {
		if err := tx.AppendAudit(ctx, entity.AuditEntry{CaseID: caseID, Actor: entity.ActorSupport, Step: req.Name(),
			Detail: fmt.Sprintf("%s · %s", rule, msg), At: now}); err != nil {
			return entity.ActionResult{}, err
		}
		return entity.ActionResult{Status: "executed", Message: msg, Rule: rule, TechIssue: techIssue}, nil
	}

	// S1 applies to every kind of action, not only support actions (docs/api.md → case_107).
	if outcome == entity.OutcomeSuspicious {
		return blocked(entity.RuleSuspicious, "Case is flagged as suspicious; no actions allowed.")
	}

	switch req.Kind {
	case entity.KindSupportAction:
		recs, err := tx.CustomerRecords(ctx, kase.CustomerID)
		if err != nil {
			return entity.ActionResult{}, err
		}
		recs.Now = now
		gate := entity.EvaluateAction(*req.Action, outcome, recs)
		if !gate.Allowed {
			return blocked(gate.Rule, gate.Reason)
		}
		var msg string
		switch req.Action.Type {
		case entity.ActionRestoreAccess:
			pay, _ := entity.LatestSucceededPayment(recs.Payments) // gate guarantees one exists
			if err := tx.RestoreEntitlement(ctx, req.Action.EntitlementID, pay.ID, now); err != nil {
				return entity.ActionResult{}, err
			}
			msg = fmt.Sprintf("Access restored on %s (backed by %s).", req.Action.EntitlementID, pay.ID)
		case entity.ActionRefundPayment:
			if err := tx.RefundPayment(ctx, req.Action.PaymentID); err != nil {
				return entity.ActionResult{}, err
			}
			amount := 0.0
			for _, p := range recs.Payments {
				if p.ID == req.Action.PaymentID {
					amount = p.AmountUSD
				}
			}
			msg = fmt.Sprintf("Refunded $%.2f (%s).", amount, req.Action.PaymentID)
		case entity.ActionCancelSubscription, entity.ActionSendMagicLink:
			if msg, err = applyFixConnector(ctx, tx, kase.CustomerID, *req.Action, recs, now); err != nil {
				return entity.ActionResult{}, err
			}
		}
		if err := tx.SetCaseStatus(ctx, caseID, entity.CaseResolved); err != nil {
			return entity.ActionResult{}, err
		}
		return executed(gate.Rule, msg, nil)

	case entity.KindSendToTech:
		if kase.Verdict == nil || outcome != entity.OutcomeTechTeam || kase.Verdict.TechIssue == nil {
			return entity.ActionResult{}, entity.Fail(entity.ErrConflict, "send_to_tech needs a tech_team verdict.")
		}
		billing, err := tx.Billing(ctx)
		if err != nil {
			return entity.ActionResult{}, err
		}
		existing, err := tx.OpenTechIssue(ctx, kase.Verdict.TechIssue.Signature)
		if err != nil {
			return entity.ActionResult{}, err
		}
		newID := ""
		if existing == nil {
			if newID, err = tx.NextTechIssueID(ctx); err != nil {
				return entity.ActionResult{}, err
			}
		}
		affected := entity.FindBySignature(billing, kase.Verdict.TechIssue.Signature)
		card := entity.MergeTechIssue(existing, newID, caseID, kase.CustomerID, *kase.Verdict, affected, now)
		if err := tx.SaveTechIssue(ctx, card); err != nil {
			return entity.ActionResult{}, err
		}
		if err := tx.SetCaseStatus(ctx, caseID, entity.CaseWithTech); err != nil {
			return entity.ActionResult{}, err
		}
		verb := "Created"
		if existing != nil {
			verb = "Merged into"
		}
		return executed(entity.RuleTechBoard, fmt.Sprintf("%s tech card %q · %d customers.", verb, card.Title, len(card.AffectedCustomerIDs)), &card)

	case entity.KindMarkResolved:
		if err := tx.SetCaseStatus(ctx, caseID, entity.CaseResolved); err != nil {
			return entity.ActionResult{}, err
		}
		return executed(entity.RuleNone, "Case marked resolved.", nil)
	}
	return entity.ActionResult{}, entity.Fail(entity.ErrBadRequest, "Unknown action kind.")
}
