// Package usecase holds one file per use case. Ports (interfaces) for repos and adapters live next to their users.
package usecase

import (
	"context"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/seed"
)

// DemoStore replaces every piece of demo state in one transaction.
type DemoStore interface {
	ReplaceWorld(ctx context.Context, w entity.World) error
}

// ResetDemo restores the deterministic demo world: used by `make seed` and DELETE /api/state.
type ResetDemo struct{ store DemoStore }

func NewResetDemo(store DemoStore) *ResetDemo { return &ResetDemo{store: store} }

// Execute writes a fresh seed world and returns it (callers log counts).
func (u *ResetDemo) Execute(ctx context.Context) (entity.World, error) {
	w := seed.World()
	return w, u.store.ReplaceWorld(ctx, w)
}
