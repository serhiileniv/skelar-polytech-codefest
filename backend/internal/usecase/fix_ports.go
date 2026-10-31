package usecase

import "github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"

// FixPlanStore holds one pending Fix-it plan per case (in memory; a restart drops plans → approve 404).
type FixPlanStore interface {
	// Update atomically replaces the case's plan with fn's result. ok=false when the case has no plan.
	// An error from fn leaves the stored plan unchanged and is returned as is.
	Update(caseID string, fn func(cur entity.FixPlan, ok bool) (entity.FixPlan, error)) (entity.FixPlan, error)
}
