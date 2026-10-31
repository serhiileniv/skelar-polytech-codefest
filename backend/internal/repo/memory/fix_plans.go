// Package memory implements in-process stores that need no persistence.
package memory

import (
	"sync"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// FixPlans implements usecase.FixPlanStore with a mutex-guarded map of plan values.
type FixPlans struct {
	mu    sync.Mutex
	plans map[string]entity.FixPlan
}

func NewFixPlans() *FixPlans { return &FixPlans{plans: map[string]entity.FixPlan{}} }

func (s *FixPlans) Update(caseID string, fn func(cur entity.FixPlan, ok bool) (entity.FixPlan, error)) (entity.FixPlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.plans[caseID]
	next, err := fn(cur, ok)
	if err != nil {
		return cur, err
	}
	s.plans[caseID] = next
	return next, nil
}
