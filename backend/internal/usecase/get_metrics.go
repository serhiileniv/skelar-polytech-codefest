package usecase

import (
	"context"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// GetMetrics serves GET /api/metrics.
type GetMetrics struct{ store MetricsStore }

func NewGetMetrics(store MetricsStore) *GetMetrics { return &GetMetrics{store: store} }

func (u *GetMetrics) Execute(ctx context.Context) (entity.Metrics, error) {
	total, verdicts, actions, eval, err := u.store.MetricsInputs(ctx)
	if err != nil {
		return entity.Metrics{}, err
	}
	return entity.ComputeMetrics(total, verdicts, actions, eval), nil
}
