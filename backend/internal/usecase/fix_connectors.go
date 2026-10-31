package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/serhiileniv/skelar-polytech-codefest/backend/internal/entity"
)

// applyFixConnector runs a gate-approved Fix-it action through a simulated connector (decisions 1–2 in
// docs/specs/fix-it-agent.md): the "App Store" and email systems are our demo world tables.
func applyFixConnector(ctx context.Context, tx CaseTx, customerID string, a entity.SupportAction, recs entity.CustomerRecords, now time.Time) (string, error) {
	switch a.Type {
	case entity.ActionCancelSubscription:
		if err := tx.CancelSubscription(ctx, a.SubscriptionID, now); err != nil {
			return "", err
		}
		via := "web billing"
		for _, s := range recs.Subscriptions {
			if s.ID == a.SubscriptionID && s.Channel == entity.ChannelAppStore {
				via = "simulated App Store connector"
			}
		}
		return fmt.Sprintf("Subscription %s canceled via %s; no further renewals.", a.SubscriptionID, via), nil
	case entity.ActionSendMagicLink:
		id, err := tx.AddEmail(ctx, customerID, entity.MagicLinkTemplate, now)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("One-time login link sent (%s, simulated email connector).", id), nil
	}
	return "", fmt.Errorf("no connector for %s", a.Type)
}
