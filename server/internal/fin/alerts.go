package fin

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Alert is something worth telling the person about their money.
//
//	over_budget   a category (or TOTAL) went over its monthly budget
//	near_budget   a budget reached 90%
//	low_balance   bank cash fell under their limit
//	large_charge  one charge at or above their limit
//	bill_due      a recurring payment is expected in the next 3 days
type Alert struct {
	ID          uuid.UUID `json:"id"`
	Kind        string    `json:"kind"`
	Category    string    `json:"category,omitempty"`
	Name        string    `json:"name,omitempty"`
	AmountCents int64     `json:"amount_cents"`
	Currency    string    `json:"currency"`
	CreatedAt   time.Time `json:"created_at"`
	Read        bool      `json:"read"`
	key         string
}

type AlertSettings struct {
	Budget     bool  `json:"budget"`
	LowBalance bool  `json:"low_balance"`
	LowCents   int64 `json:"low_cents"`
	Large      bool  `json:"large"`
	LargeCents int64 `json:"large_cents"`
	Bills      bool  `json:"bills"`
	SMS        bool  `json:"sms"`
}

var defaultSettings = AlertSettings{Budget: true, LowBalance: true, LowCents: 50000, Large: true, LargeCents: 50000, Bills: true}

// Notifier is told about each new alert (push, and later SMS).
type Notifier func(user string, a Alert, s AlertSettings)

// WithNotifier sends new alerts somewhere (push alerts).
func (s *Service) WithNotifier(n Notifier) *Service {
	if s != nil {
		s.notifier = n
	}
	return s
}

func (s *Service) AlertSettings(ctx context.Context, user string) (AlertSettings, error) {
	a := defaultSettings
	err := s.pool.QueryRow(ctx, `SELECT budget, low_balance, low_cents, large, large_cents, bills, sms FROM fin_alert_settings WHERE user_id = $1`, user).
		Scan(&a.Budget, &a.LowBalance, &a.LowCents, &a.Large, &a.LargeCents, &a.Bills, &a.SMS)
	if isNoRows(err) {
		return defaultSettings, nil
	}
	return a, err
}

// SaveAlertSettings stores the switches. SMS stays off until texts are available.
func (s *Service) SaveAlertSettings(ctx context.Context, user string, a AlertSettings, smsAvailable bool) (AlertSettings, error) {
	if a.LowCents < 0 || a.LowCents > 100_000_000 || a.LargeCents < 100 || a.LargeCents > 100_000_000 {
		return a, fmt.Errorf("%w: check the amounts", ErrInvalid)
	}
	if !smsAvailable {
		a.SMS = false
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO fin_alert_settings (user_id, budget, low_balance, low_cents, large, large_cents, bills, sms)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (user_id) DO UPDATE SET budget = $2, low_balance = $3, low_cents = $4, large = $5, large_cents = $6,
			bills = $7, sms = $8, updated_at = now()`, user, a.Budget, a.LowBalance, a.LowCents, a.Large, a.LargeCents, a.Bills, a.SMS)
	return a, err
}

// Alerts returns the latest alerts and how many are unread.
func (s *Service) Alerts(ctx context.Context, user string) ([]Alert, int, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, kind, category, name, amount_cents, currency, created_at, read_at IS NOT NULL
		FROM fin_alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60`, user)
	if err != nil {
		return nil, 0, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Alert, error) {
		var a Alert
		err := r.Scan(&a.ID, &a.Kind, &a.Category, &a.Name, &a.AmountCents, &a.Currency, &a.CreatedAt, &a.Read)
		return a, err
	})
	if err != nil {
		return nil, 0, err
	}
	unread := 0
	for _, a := range list {
		if !a.Read {
			unread++
		}
	}
	return list, unread, nil
}

func (s *Service) MarkAlertsRead(ctx context.Context, user string) error {
	_, err := s.pool.Exec(ctx, `UPDATE fin_alerts SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, user)
	return err
}

// checkAlerts runs after a sync. added are the new transactions from it.
func (s *Service) checkAlerts(ctx context.Context, user string, today time.Time, added []plaidTxn) error {
	set, err := s.AlertSettings(ctx, user)
	if err != nil {
		return err
	}
	var found []Alert
	month := today.Format("2006-01")

	b, err := s.Budgets(ctx, user, today, today)
	if err != nil {
		return err
	}
	cur := b.Currency
	if set.Budget {
		all := b.Budgets
		if b.Overall != nil {
			all = append([]Budget{*b.Overall}, all...)
		}
		for _, x := range all {
			switch {
			case x.SpentCents > x.AmountCents:
				found = append(found, Alert{Kind: "over_budget", Category: x.Category, AmountCents: x.SpentCents - x.AmountCents, key: "over:" + x.Category + ":" + month})
			case x.SpentCents*100 >= x.AmountCents*90:
				found = append(found, Alert{Kind: "near_budget", Category: x.Category, AmountCents: x.AmountCents - x.SpentCents, key: "near:" + x.Category + ":" + month})
			}
		}
	}

	if set.LowBalance {
		var cash int64
		var n int
		err := s.pool.QueryRow(ctx, `SELECT coalesce(sum(coalesce(available_cents, current_cents)), 0)::bigint, count(*) FROM fin_accounts
			WHERE user_id = $1 AND type = 'depository' AND currency = $2 AND coalesce(available_cents, current_cents) IS NOT NULL`, user, cur).Scan(&cash, &n)
		if err != nil {
			return err
		}
		if n > 0 && cash < set.LowCents {
			y, w := today.ISOWeek()
			found = append(found, Alert{Kind: "low_balance", AmountCents: cash, key: fmt.Sprintf("low:%d-W%02d", y, w)})
		}
	}

	if set.Large {
		since := today.AddDate(0, 0, -3)
		for _, t := range added {
			d, err := time.Parse("2006-01-02", t.Date)
			if err != nil || d.Before(since) || notSpending[t.Category.Primary] || toCents(t.Amount) < set.LargeCents {
				continue
			}
			name := t.MerchantName
			if name == "" {
				name = t.Name
			}
			c := t.Currency
			if c == "" {
				c = cur
			}
			found = append(found, Alert{Kind: "large_charge", Name: clip(name, 60), AmountCents: toCents(t.Amount), Currency: c, key: "large:" + t.TransactionID})
		}
	}

	if set.Bills {
		rec, err := s.Recurring(ctx, user, cur, today)
		if err != nil {
			return err
		}
		for _, r := range rec {
			due := r.last.AddDate(0, 1, 0)
			if days := due.Sub(today).Hours() / 24; days >= 0 && days <= 3 {
				found = append(found, Alert{Kind: "bill_due", Name: clip(r.Name, 60), Category: r.Category, AmountCents: r.MonthlyCents,
					key: "bill:" + clip(r.Name, 60) + ":" + due.Format("2006-01-02")})
			}
		}
	}

	for _, a := range found {
		if a.Currency == "" {
			a.Currency = cur
		}
		a.ID = uuid.New()
		tag, err := s.pool.Exec(ctx, `INSERT INTO fin_alerts (id, user_id, kind, dedupe_key, category, name, amount_cents, currency)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
			a.ID, user, a.Kind, a.key, a.Category, a.Name, a.AmountCents, a.Currency)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 1 && s.notifier != nil {
			a.CreatedAt = s.now()
			s.notifier(user, a, set)
		}
	}
	return nil
}

// SyncAll refreshes every bank not synced for a while, so alerts arrive even
// when the app isn't open. Run it on a timer.
func (s *Service) SyncAll(ctx context.Context, olderThan time.Duration) {
	if s == nil {
		return
	}
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT user_id FROM fin_items
		WHERE status = 'ok' AND (synced_at IS NULL OR synced_at < now() - $1::interval)`, fmt.Sprintf("%d seconds", int(olderThan.Seconds())))
	if err != nil {
		log.Printf("[FIN] sync all: %v", err)
		return
	}
	users, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		log.Printf("[FIN] sync all: %v", err)
		return
	}
	for _, u := range users {
		if ctx.Err() != nil {
			return
		}
		_ = s.Refresh(ctx, u, olderThan)
	}
}
