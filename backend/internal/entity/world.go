// Package entity holds business objects and pure rules. No HTTP, SQL or LLM imports.
// Types mirror docs/api.md; JSON tags are the contract.
package entity

import "time"

type Platform string

const (
	PlatformWeb     Platform = "web"
	PlatformIOS     Platform = "ios"
	PlatformAndroid Platform = "android"
)

type Channel string

const (
	ChannelWeb      Channel = "web"
	ChannelAppStore Channel = "app_store"
)

type Plan string

const (
	PlanMonthly Plan = "monthly"
	PlanYearly  Plan = "yearly"
)

type SubscriptionStatus string

const (
	SubscriptionActive   SubscriptionStatus = "active"
	SubscriptionCanceled SubscriptionStatus = "canceled"
)

type PaymentStatus string

const (
	PaymentSucceeded PaymentStatus = "succeeded"
	PaymentRefunded  PaymentStatus = "refunded"
	PaymentFailed    PaymentStatus = "failed"
)

type Customer struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Email      string    `json:"email"`
	Platform   Platform  `json:"platform"`
	AppVersion string    `json:"appVersion"`
	Country    string    `json:"country"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Subscription struct {
	ID         string             `json:"id"`
	CustomerID string             `json:"-"`
	Channel    Channel            `json:"channel"`
	Plan       Plan               `json:"plan"`
	PriceUSD   float64            `json:"priceUsd"`
	Status     SubscriptionStatus `json:"status"`
	RenewsAt   *time.Time         `json:"renewsAt"`
	CanceledAt *time.Time         `json:"canceledAt"`
}

type Payment struct {
	ID             string        `json:"id"`
	CustomerID     string        `json:"-"`
	SubscriptionID string        `json:"subscriptionId"`
	Channel        Channel       `json:"channel"`
	AmountUSD      float64       `json:"amountUsd"`
	Status         PaymentStatus `json:"status"`
	At             time.Time     `json:"at"`
}

type Entitlement struct {
	ID           string     `json:"id"`
	CustomerID   string     `json:"-"`
	AccountEmail string     `json:"accountEmail"`
	Active       bool       `json:"active"`
	PaymentID    *string    `json:"paymentId"`
	GrantedAt    *time.Time `json:"grantedAt"`
}

// SessionEvent is what the user did, from web analytics and the mobile apps.
type SessionEvent struct {
	ID         string    `json:"id"`
	CustomerID string    `json:"-"`
	Source     Platform  `json:"source"`
	Type       string    `json:"type"` // login, cancel_clicked, app_deleted, open_lessons, password_reset_requested, ...
	Detail     string    `json:"detail,omitempty"`
	AppVersion string    `json:"appVersion,omitempty"`
	At         time.Time `json:"at"`
}

// ErrorLog is a backend / app error line. CustomerID may be empty for global errors.
type ErrorLog struct {
	ID         string    `json:"id"`
	CustomerID string    `json:"-"`
	Service    string    `json:"service"` // billing | entitlements | auth | email | app
	Code       string    `json:"code"`
	Message    string    `json:"message"`
	AppVersion string    `json:"appVersion,omitempty"`
	At         time.Time `json:"at"`
}

type EmailLog struct {
	ID         string    `json:"id"`
	CustomerID string    `json:"-"`
	To         string    `json:"to"`
	Template   string    `json:"template"`
	Status     string    `json:"status"` // delivered | bounced
	At         time.Time `json:"at"`
}

type HelpArticle struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Steps []string `json:"steps"`
	Tags  []string `json:"tags"`
}

// World is the full simulated dataset: what `make seed` writes and DELETE /api/state restores.
type World struct {
	Now           time.Time
	Customers     []Customer
	Subscriptions []Subscription
	Payments      []Payment
	Entitlements  []Entitlement
	Events        []SessionEvent
	Errors        []ErrorLog
	Emails        []EmailLog
	Help          []HelpArticle
	Cases         []Case
}
