package fin

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// Tip is one piece of advice made from the person's own numbers. The app
// writes the sentence (in their language) from Kind and the values.
type Tip struct {
	Kind        string   `json:"kind"`
	Tone        string   `json:"tone"` // warn | info | good
	Category    string   `json:"category,omitempty"`
	AmountCents int64    `json:"amount_cents,omitempty"`
	Percent     int      `json:"percent,omitempty"`
	Count       int      `json:"count,omitempty"`
	Names       []string `json:"names,omitempty"`
}

type Tips struct {
	Currency string `json:"currency"`
	Tips     []Tip  `json:"tips"`
}

// Recurring is a payment that came back at about the same amount in at least
// two of the last three months (subscriptions, bills).
type Recurring struct {
	Name         string `json:"name"`
	MonthlyCents int64  `json:"monthly_cents"`
	Category     string `json:"category"`
	LastDate     string `json:"last_date"`
	last         time.Time
}

func (s *Service) Recurring(ctx context.Context, user, currency string, today time.Time) ([]Recurring, error) {
	rows, err := s.pool.Query(ctx, `SELECT name, avg_cents, category, last FROM (
			SELECT coalesce(nullif(merchant_name, ''), name) AS name, (avg(amount_cents))::bigint AS avg_cents,
				min(category) AS category, count(DISTINCT date_trunc('month', date)) AS months,
				max(amount_cents) - min(amount_cents) AS spread, max(date) AS last
			FROM fin_transactions
			WHERE user_id = $1 AND currency = $2 AND date >= $3 AND amount_cents > 0 AND NOT pending
				AND category IN ('ENTERTAINMENT', 'GENERAL_SERVICES', 'RENT_AND_UTILITIES', 'PERSONAL_CARE', 'MEDICAL')
			GROUP BY 1) r
		WHERE months >= 2 AND spread <= greatest(avg_cents / 5, 100)
		ORDER BY avg_cents DESC LIMIT 12`, user, currency, monthStart(today).AddDate(0, -3, 0))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Recurring, error) {
		var x Recurring
		err := r.Scan(&x.Name, &x.MonthlyCents, &x.Category, &x.last)
		x.LastDate = x.last.Format("2006-01-02")
		return x, err
	})
}

var general = []Tip{
	{Kind: "emergency_fund", Tone: "info"},
	{Kind: "rule_50_30_20", Tone: "info"},
	{Kind: "pay_yourself_first", Tone: "info"},
	{Kind: "likelemba", Tone: "info"},
}

// Tips looks at this month, budgets, balances and recurring payments.
func (s *Service) Tips(ctx context.Context, user string, today time.Time) (*Tips, error) {
	b, err := s.Budgets(ctx, user, today, today)
	if err != nil {
		return nil, err
	}
	out := &Tips{Currency: b.Currency, Tips: []Tip{}}
	add := func(t Tip) { out.Tips = append(out.Tips, t) }

	if b.Connected {
		// Budgets: over, or close to it with time left.
		for _, x := range b.Budgets {
			switch {
			case x.SpentCents > x.AmountCents:
				add(Tip{Kind: "over_budget", Tone: "warn", Category: x.Category, AmountCents: x.SpentCents - x.AmountCents})
			case x.SpentCents*100 >= x.AmountCents*80 && today.Day() <= 24:
				add(Tip{Kind: "near_budget", Tone: "warn", Category: x.Category, AmountCents: x.AmountCents - x.SpentCents,
					Percent: int(x.SpentCents * 100 / x.AmountCents)})
			}
		}
		if o := b.Overall; o != nil && o.SpentCents <= o.AmountCents && b.DaysInMonth > 0 {
			// Spending faster than the month is going.
			used := float64(o.SpentCents) / float64(o.AmountCents)
			elapsed := float64(today.Day()) / float64(b.DaysInMonth)
			if used > elapsed+0.15 {
				add(Tip{Kind: "ahead_of_pace", Tone: "warn", Percent: int(used * 100), Count: int(elapsed * 100)})
			}
		}

		ov, err := s.Overview(ctx, user, today)
		if err != nil {
			return nil, err
		}
		m := ov.Month
		if m.LastMonthCents >= 5000 && m.SpentCents > m.LastMonthCents*120/100 {
			add(Tip{Kind: "spend_up", Tone: "warn", Percent: int((m.SpentCents - m.LastMonthCents) * 100 / m.LastMonthCents),
				AmountCents: m.SpentCents - m.LastMonthCents})
		}

		// Cash and cards.
		var cash, used, limit int64
		hasBank := false
		for _, bank := range ov.Banks {
			for _, a := range bank.Accounts {
				if a.Currency != ov.Currency || a.CurrentCents == nil {
					continue
				}
				if a.Type == "depository" {
					hasBank = true
					if a.AvailableCents != nil {
						cash += *a.AvailableCents
					} else {
						cash += *a.CurrentCents
					}
				}
				if a.Type == "credit" && a.LimitCents != nil && *a.LimitCents > 0 {
					used += *a.CurrentCents
					limit += *a.LimitCents
				}
			}
		}
		if hasBank && cash < 50000 {
			add(Tip{Kind: "low_cash", Tone: "warn", AmountCents: cash})
		}
		if limit > 0 && used*100 > limit*30 {
			add(Tip{Kind: "credit_use", Tone: "warn", Percent: int(used * 100 / limit)})
		}
		for _, c := range m.ByCategory {
			if c.Category == "BANK_FEES" && c.Cents > 0 {
				add(Tip{Kind: "bank_fees", Tone: "warn", AmountCents: c.Cents})
			}
		}

		// Recurring payments.
		rec, err := s.Recurring(ctx, user, ov.Currency, today)
		if err != nil {
			return nil, err
		}
		var subs []Recurring
		for _, r := range rec {
			if r.Category == "ENTERTAINMENT" || r.Category == "GENERAL_SERVICES" || r.Category == "PERSONAL_CARE" {
				subs = append(subs, r)
			}
		}
		if len(subs) > 0 {
			t := Tip{Kind: "subscriptions", Tone: "info", Count: len(subs)}
			for i, r := range subs {
				t.AmountCents += r.MonthlyCents
				if i < 3 {
					t.Names = append(t.Names, clip(r.Name, 30))
				}
			}
			add(t)
		}

		// The biggest category: what a 20% cut would save.
		if len(m.ByCategory) > 0 && m.SpentCents > 0 {
			top := m.ByCategory[0]
			if pct := int(top.Cents * 100 / m.SpentCents); pct >= 25 && top.Category != "RENT_AND_UTILITIES" {
				add(Tip{Kind: "top_category", Tone: "info", Category: top.Category, Percent: pct, AmountCents: roundUp(top.Cents/5, 100)})
			}
		}

		// Money left after spending: put some aside.
		if m.IncomeCents > 0 && m.SpentCents < m.IncomeCents {
			left := m.IncomeCents - m.SpentCents
			add(Tip{Kind: "save_left", Tone: "good", AmountCents: left, Percent: int(left * 100 / m.IncomeCents)})
		}
		if len(b.Budgets) == 0 && b.Overall == nil && len(b.Suggestions) > 0 {
			add(Tip{Kind: "make_budget", Tone: "info", Count: len(b.Suggestions)})
		}
	}

	rank := map[string]int{"warn": 0, "info": 1, "good": 2}
	sort.SliceStable(out.Tips, func(i, j int) bool { return rank[out.Tips[i].Tone] < rank[out.Tips[j].Tone] })
	if len(out.Tips) > 6 {
		out.Tips = out.Tips[:6]
	}
	// Not much to say yet: money basics.
	for i := 0; len(out.Tips) < 3 && i < len(general); i++ {
		out.Tips = append(out.Tips, general[(today.YearDay()+i)%len(general)])
	}
	return out, nil
}

// Names for logs and tests.
func (t Tip) String() string { return t.Kind + ":" + strings.ToLower(t.Category) }
