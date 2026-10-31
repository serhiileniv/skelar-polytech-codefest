package usecase

import (
	"context"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// ReplyToCase appends a support message (POST /api/cases/{id}/reply) and returns the fresh case detail.
// An open case moves to waiting_customer; other statuses are kept.
type ReplyToCase struct {
	store CaseStore
	read  CaseReader
	now   Clock
}

func NewReplyToCase(store CaseStore, read CaseReader, now Clock) *ReplyToCase {
	return &ReplyToCase{store: store, read: read, now: now}
}

func (u *ReplyToCase) Execute(ctx context.Context, caseID, body string) (entity.CaseDetail, error) {
	if err := checkID(caseID); err != nil {
		return entity.CaseDetail{}, err
	}
	text, err := entity.CheckReply(body)
	if err != nil {
		return entity.CaseDetail{}, err
	}
	err = u.store.InTx(ctx, func(tx CaseTx) error {
		kase, err := tx.LockCase(ctx, caseID)
		if err != nil {
			return err
		}
		id, err := tx.NextReplyID(ctx)
		if err != nil {
			return err
		}
		now := u.now()
		if err := tx.AddMessage(ctx, caseID, entity.ChatMessage{ID: id, From: entity.FromSupport, Body: text, At: now}); err != nil {
			return err
		}
		if kase.Status == entity.CaseOpen {
			if err := tx.SetCaseStatus(ctx, caseID, entity.CaseWaitingCustomer); err != nil {
				return err
			}
		}
		return tx.AppendAudit(ctx, entity.AuditEntry{CaseID: caseID, Actor: entity.ActorSupport, Step: "reply",
			Detail: entity.Truncate(text, entity.PreviewChars), At: now})
	})
	if err != nil {
		return entity.CaseDetail{}, err
	}
	return u.read.CaseDetail(ctx, caseID)
}
