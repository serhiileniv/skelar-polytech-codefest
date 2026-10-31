package usecase

import (
	"context"
	"errors"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// ExpectedOutcomes is the "Demo cases" table in docs/api.md.
var ExpectedOutcomes = []struct {
	CaseID  string
	Outcome entity.Outcome
}{
	{"case_101", entity.OutcomeUserCanFix},
	{"case_102", entity.OutcomeUserCanFix},
	{"case_103", entity.OutcomeSupportCanFix},
	{"case_104", entity.OutcomeTechTeam},
	{"case_105", entity.OutcomeSupportCanFix},
	{"case_106", entity.OutcomeNeedMoreInfo},
	{"case_107", entity.OutcomeSuspicious},
}

// EvalCase is one row of an eval run.
type EvalCase struct {
	CaseID   string
	Expected entity.Outcome
	Got      entity.Outcome
	Steps    int
	Replay   bool
	Err      error
}

// RunEval investigates every demo case on a fresh world, scores outcomes against the contract, stores the score,
// then restores the fresh world (the eval score survives the reset).
type RunEval struct {
	reset       *ResetDemo
	investigate *InvestigateCase
	metrics     MetricsStore
	now         Clock
}

func NewRunEval(reset *ResetDemo, investigate *InvestigateCase, metrics MetricsStore, now Clock) *RunEval {
	return &RunEval{reset: reset, investigate: investigate, metrics: metrics, now: now}
}

func (u *RunEval) Execute(ctx context.Context) ([]EvalCase, int, error) {
	if _, err := u.reset.Execute(ctx); err != nil {
		return nil, 0, err
	}
	rows := make([]EvalCase, 0, len(ExpectedOutcomes))
	correct := 0
	for _, exp := range ExpectedOutcomes {
		row := EvalCase{CaseID: exp.CaseID, Expected: exp.Outcome}
		inv, err := u.investigate.Start(ctx, exp.CaseID)
		if err == nil {
			row.Replay = inv.Info.Replay
			var v entity.Verdict
			v, err = inv.Run(ctx, func(string, any) error { return nil })
			row.Got, row.Steps = v.Outcome, v.StepsUsed
		}
		row.Err = err
		if err == nil && row.Got == row.Expected {
			correct++
		}
		rows = append(rows, row)
	}
	if err := u.metrics.SaveEvalRun(ctx, correct, len(rows), u.now()); err != nil {
		return rows, correct, err
	}
	_, err := u.reset.Execute(ctx)
	return rows, correct, err
}

func isKind(err, kind error) bool { return errors.Is(err, kind) }
