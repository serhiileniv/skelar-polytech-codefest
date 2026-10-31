package entity

import (
	"slices"
	"sort"
	"time"
)

// Billing is the structured data the root-cause detectors read (never case text).
type Billing struct {
	Subscriptions []Subscription
	Payments      []Payment
	Entitlements  []Entitlement
}

// Signatures lists every known root-cause signature.
var Signatures = []Signature{SignatureCancelNotSynced, SignatureEntitlementGrantFailed, SignatureDuplicateCharge}

func (s Signature) Valid() bool { return slices.Contains(Signatures, s) }

const (
	cancelSyncWindow = 60 * time.Minute
	duplicateWindow  = 5 * time.Minute
)

// FindBySignature returns the sorted ids of every customer whose records match the signature.
// Port of src/lib/domain/detectors.ts.
func FindBySignature(b Billing, sig Signature) []string {
	hits := map[string]bool{}
	switch sig {
	case SignatureCancelNotSynced:
		// Web cancel followed by a succeeded (not refunded) App Store charge within 60 min.
		for _, web := range b.Subscriptions {
			if web.Channel != ChannelWeb || web.Status != SubscriptionCanceled || web.CanceledAt == nil {
				continue
			}
			for _, p := range b.Payments {
				d := p.At.Sub(*web.CanceledAt)
				if p.CustomerID == web.CustomerID && p.Channel == ChannelAppStore && p.Status == PaymentSucceeded && d > 0 && d <= cancelSyncWindow {
					hits[web.CustomerID] = true
					break
				}
			}
		}
	case SignatureEntitlementGrantFailed:
		// Succeeded payment on an active subscription, but no active entitlement for the customer.
		active, entitled := map[string]bool{}, map[string]bool{}
		for _, s := range b.Subscriptions {
			if s.Status == SubscriptionActive {
				active[s.ID] = true
			}
		}
		for _, e := range b.Entitlements {
			if e.Active {
				entitled[e.CustomerID] = true
			}
		}
		for _, p := range b.Payments {
			if p.Status == PaymentSucceeded && active[p.SubscriptionID] && !entitled[p.CustomerID] {
				hits[p.CustomerID] = true
			}
		}
	case SignatureDuplicateCharge:
		// Two succeeded payments on the same subscription within 5 min (refunded ones don't count).
		bySub := map[string][]Payment{}
		for _, p := range b.Payments {
			if p.Status == PaymentSucceeded {
				bySub[p.SubscriptionID] = append(bySub[p.SubscriptionID], p)
			}
		}
		for _, list := range bySub {
			sort.Slice(list, func(i, j int) bool { return list[i].At.Before(list[j].At) })
			for i := 1; i < len(list); i++ {
				if list[i].At.Sub(list[i-1].At) <= duplicateWindow {
					hits[list[i].CustomerID] = true
				}
			}
		}
	}
	out := make([]string, 0, len(hits))
	for id := range hits {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}
