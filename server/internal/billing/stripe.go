// Package billing handles paid plans via Stripe (cards, Apple Pay, Google Pay,
// SEPA, ...) for users in the US and Europe.
//
// Flow: the user clicks Upgrade -> Checkout creates a Stripe-hosted payment
// page -> Stripe calls our webhook when the subscription is created, renewed,
// changed or cancelled -> the webhook updates the subscriptions table, which
// decides the user's plan and limits. "Manage subscription" opens Stripe's
// Customer Portal (change card, invoices, cancel).
package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/clerk/clerk-sdk-go/v2/user"
	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"

	"mayelai/server/internal/config"
	"mayelai/server/internal/db"
)

var (
	ErrAlreadySubscribed = errors.New("already on a paid plan")
	ErrNoCustomer        = errors.New("no billing account yet")
	ErrBadSignature      = errors.New("invalid webhook signature")
)

type Stripe struct {
	cfg   config.Config
	sc    *stripe.Client
	store *db.Store

	priceMu      sync.Mutex
	price        *Price
	priceFetched time.Time
}

// New returns nil if Stripe isn't configured.
func New(cfg config.Config, store *db.Store) *Stripe {
	if !cfg.BillingEnabled() {
		return nil
	}
	return &Stripe{cfg: cfg, sc: stripe.NewClient(cfg.StripeSecretKey), store: store}
}

// Price is the Pro plan's price, for display.
type Price struct {
	Amount        int64  `json:"amount"` // in the smallest currency unit (cents)
	Currency      string `json:"currency"`
	Interval      string `json:"interval"` // month, year, week
	IntervalCount int64  `json:"intervalCount"`
}

// ProPrice returns the Pro price, cached for an hour.
func (s *Stripe) ProPrice(ctx context.Context) (*Price, error) {
	s.priceMu.Lock()
	defer s.priceMu.Unlock()
	if s.price != nil && time.Since(s.priceFetched) < time.Hour {
		return s.price, nil
	}
	p, err := s.sc.V1Prices.Retrieve(ctx, s.cfg.StripeProPriceID, nil)
	if err != nil {
		return nil, err
	}
	price := &Price{Amount: p.UnitAmount, Currency: string(p.Currency)}
	if p.Recurring != nil {
		price.Interval, price.IntervalCount = string(p.Recurring.Interval), p.Recurring.IntervalCount
	}
	s.price, s.priceFetched = price, time.Now()
	return price, nil
}

// Checkout creates a Stripe Checkout page for the Pro plan and returns its URL.
func (s *Stripe) Checkout(ctx context.Context, userID string) (string, error) {
	sub, err := s.store.GetSubscription(ctx, userID)
	if err != nil {
		return "", err
	}
	if sub.Plan != "free" {
		return "", ErrAlreadySubscribed
	}
	customerID, err := s.ensureCustomer(ctx, userID, sub.CustomerID)
	if err != nil {
		return "", err
	}
	sess, err := s.sc.V1CheckoutSessions.Create(ctx, &stripe.CheckoutSessionCreateParams{
		Mode:              stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		Customer:          stripe.String(customerID),
		ClientReferenceID: stripe.String(userID),
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{
			{Price: stripe.String(s.cfg.StripeProPriceID), Quantity: stripe.Int64(1)},
		},
		SubscriptionData: &stripe.CheckoutSessionCreateSubscriptionDataParams{
			Metadata: map[string]string{"user_id": userID},
		},
		AllowPromotionCodes: stripe.Bool(true),
		SuccessURL:          stripe.String(s.cfg.AppURL + "/settings?checkout=success"),
		CancelURL:           stripe.String(s.cfg.AppURL + "/settings?checkout=cancel"),
	})
	if err != nil {
		return "", err
	}
	return sess.URL, nil
}

// Portal returns a URL to Stripe's Customer Portal for managing the subscription.
func (s *Stripe) Portal(ctx context.Context, userID string) (string, error) {
	sub, err := s.store.GetSubscription(ctx, userID)
	if err != nil {
		return "", err
	}
	if sub.CustomerID == "" {
		return "", ErrNoCustomer
	}
	sess, err := s.sc.V1BillingPortalSessions.Create(ctx, &stripe.BillingPortalSessionCreateParams{
		Customer:  stripe.String(sub.CustomerID),
		ReturnURL: stripe.String(s.cfg.AppURL + "/settings"),
	})
	if err != nil {
		return "", err
	}
	return sess.URL, nil
}

// ensureCustomer returns the user's Stripe customer, creating it (with their
// Clerk email and user ID) the first time.
func (s *Stripe) ensureCustomer(ctx context.Context, userID, existing string) (string, error) {
	if existing != "" {
		return existing, nil
	}
	params := &stripe.CustomerCreateParams{Metadata: map[string]string{"user_id": userID}}
	if u, err := user.Get(ctx, userID); err == nil {
		for _, e := range u.EmailAddresses {
			if u.PrimaryEmailAddressID != nil && e.ID == *u.PrimaryEmailAddressID {
				params.Email = stripe.String(e.EmailAddress)
			}
		}
		name := strings.TrimSpace(deref(u.FirstName) + " " + deref(u.LastName))
		if name != "" {
			params.Name = stripe.String(name)
		}
	} else {
		log.Printf("billing: clerk user lookup %s: %v", userID, err)
	}
	cust, err := s.sc.V1Customers.Create(ctx, params)
	if err != nil {
		return "", err
	}
	// If two checkouts raced, the first stored customer wins.
	return s.store.SetCustomerID(ctx, userID, "stripe", cust.ID)
}

// subscriptionJSON holds the fields we need from a Stripe subscription. It is
// parsed from the raw event so it works across Stripe API versions
// (current_period_end moved from the subscription to its items in 2025).
type subscriptionJSON struct {
	ID                string            `json:"id"`
	Customer          json.RawMessage   `json:"customer"` // ID string or expanded object
	Status            string            `json:"status"`
	CancelAtPeriodEnd bool              `json:"cancel_at_period_end"`
	CancelAt          *int64            `json:"cancel_at"`
	CurrentPeriodEnd  *int64            `json:"current_period_end"`
	Metadata          map[string]string `json:"metadata"`
	Items             struct {
		Data []struct {
			CurrentPeriodEnd *int64 `json:"current_period_end"`
		} `json:"data"`
	} `json:"items"`
}

// HandleWebhook verifies and applies a Stripe webhook event.
func (s *Stripe) HandleWebhook(ctx context.Context, payload []byte, signature string) error {
	event, err := webhook.ConstructEventWithOptions(payload, signature, s.cfg.StripeWebhookSecret,
		webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true})
	if err != nil {
		return fmt.Errorf("%w: %v", ErrBadSignature, err)
	}

	switch event.Type {
	case "customer.subscription.created", "customer.subscription.updated",
		"customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed":
	default:
		return nil // not an event we use
	}

	var sub subscriptionJSON
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		return fmt.Errorf("parse subscription: %w", err)
	}
	upd := db.SubscriptionUpdate{
		UserID:            sub.Metadata["user_id"],
		Provider:          "stripe",
		CustomerID:        customerID(sub.Customer),
		SubscriptionID:    sub.ID,
		Plan:              "pro",
		Status:            sub.Status,
		CancelAtPeriodEnd: sub.CancelAtPeriodEnd || sub.CancelAt != nil,
		EventAt:           time.Unix(event.Created, 0),
	}
	if end := periodEnd(sub); end != nil {
		upd.CurrentPeriodEnd = end
	}
	matched, err := s.store.ApplySubscriptionUpdate(ctx, upd)
	if err != nil {
		return err
	}
	if !matched {
		// Not one of ours (e.g. created by hand in the dashboard). Acknowledge
		// so Stripe doesn't keep retrying.
		log.Printf("billing: %s for unknown customer %s (subscription %s)", event.Type, upd.CustomerID, sub.ID)
		return nil
	}
	log.Printf("billing: received %s customer=%s status=%s", event.Type, upd.CustomerID, sub.Status)
	return nil
}

func periodEnd(sub subscriptionJSON) *time.Time {
	ts := sub.CurrentPeriodEnd
	for _, it := range sub.Items.Data {
		if it.CurrentPeriodEnd != nil && (ts == nil || *it.CurrentPeriodEnd > *ts) {
			ts = it.CurrentPeriodEnd
		}
	}
	if ts == nil {
		return nil
	}
	t := time.Unix(*ts, 0)
	return &t
}

func customerID(raw json.RawMessage) string {
	var id string
	if json.Unmarshal(raw, &id) == nil {
		return id
	}
	var obj struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &obj)
	return obj.ID
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
