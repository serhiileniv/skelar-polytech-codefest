package usecase

import (
	"context"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// ReadCases serves the inbox, the case detail and the tech board.
type ReadCases struct {
	cases CaseReader
	board BoardReader
}

func NewReadCases(cases CaseReader, board BoardReader) *ReadCases {
	return &ReadCases{cases: cases, board: board}
}

func (u *ReadCases) List(ctx context.Context) ([]entity.CaseListItem, error) {
	return u.cases.ListCases(ctx)
}

func (u *ReadCases) Detail(ctx context.Context, caseID string) (entity.CaseDetail, error) {
	if err := checkID(caseID); err != nil {
		return entity.CaseDetail{}, err
	}
	return u.cases.CaseDetail(ctx, caseID)
}

func (u *ReadCases) Board(ctx context.Context) ([]entity.TechIssue, error) {
	return u.board.ListTechIssues(ctx)
}

func checkID(id string) error {
	if !entity.IDPattern.MatchString(id) {
		return entity.Fail(entity.ErrBadRequest, "Invalid case id.")
	}
	return nil
}
