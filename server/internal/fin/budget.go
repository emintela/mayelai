package fin

import (
	"context"
	"fmt"
	"math"
	"time"
)

// Spending categories people can budget for (Plaid primary categories), plus TOTAL.
var Budgetable = map[string]bool{
	"TOTAL": true, "FOOD_AND_DRINK": true, "RENT_AND_UTILITIES": true, "TRANSPORTATION": true, "GENERAL_MERCHANDISE": true,
	"ENTERTAINMENT": true, "PERSONAL_CARE": true, "MEDICAL": true, "TRAVEL": true, "HOME_IMPROVEMENT": true,
	"GENERAL_SERVICES": true, "GOVERNMENT_AND_NON_PROFIT": true, "BANK_FEES": true, "OTHER": true,
}

type Budget struct {
	Category    string `json:"category"`
	AmountCents int64  `json:"amount_cents"`
	SpentCents  int64  `json:"spent_cents"`
}

type BudgetView struct {
	Month      string          `json:"month"` // YYYY-MM
	Currency   string          `json:"currency"`
	Connected  bool            `json:"connected"`
	SpentCents int64           `json:"spent_cents"`
	ByCategory []CategorySpend `json:"by_category"`
	// Total: the TOTAL budget, or the sum of category budgets when there is none.
	TotalCents int64    `json:"total_cents"`
	Budgets    []Budget `json:"budgets"` // categories (not TOTAL), biggest first
	Overall    *Budget  `json:"overall"` // the TOTAL budget, if set
	// Suggestions: about what you spent per month over the last 3 months.
	Suggestions []CategorySpend `json:"suggestions"`
	DayOfMonth  int             `json:"day_of_month"` // today's day when Month is this month, else 0
	DaysInMonth int             `json:"days_in_month"`
}

// mainCurrency: the currency most of the person's accounts use (USD when none).
func (s *Service) mainCurrency(ctx context.Context, user string) (string, bool, error) {
	var cur string
	err := s.pool.QueryRow(ctx, `SELECT currency FROM fin_accounts WHERE user_id = $1
		GROUP BY currency ORDER BY count(*) DESC, (currency = 'USD') DESC LIMIT 1`, user).Scan(&cur)
	if err != nil {
		if isNoRows(err) {
			return "USD", false, nil
		}
		return "", false, err
	}
	return cur, true, nil
}

// spending sums money out per category in [from, to), leaving out transfers and income.
func (s *Service) spending(ctx context.Context, user, currency string, from, to time.Time) ([]CategorySpend, int64, error) {
	rows, err := s.pool.Query(ctx, `SELECT category, sum(amount_cents)::bigint FROM fin_transactions
		WHERE user_id = $1 AND currency = $2 AND date >= $3 AND date < $4 AND amount_cents > 0 AND NOT (category = ANY($5))
		GROUP BY category ORDER BY 2 DESC`, user, currency, from, to, keys(notSpending))
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []CategorySpend{}
	var total int64
	for rows.Next() {
		var c CategorySpend
		if err := rows.Scan(&c.Category, &c.Cents); err != nil {
			return nil, 0, err
		}
		total += c.Cents
		out = append(out, c)
	}
	return out, total, rows.Err()
}

func monthStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// ParseMonth reads YYYY-MM; empty or invalid means this month.
func ParseMonth(raw string, today time.Time) time.Time {
	if m, err := time.Parse("2006-01", raw); err == nil && !m.After(today) && today.Sub(m) < 3*365*24*time.Hour {
		return m
	}
	return monthStart(today)
}

func (s *Service) Budgets(ctx context.Context, user string, month, today time.Time) (*BudgetView, error) {
	cur, connected, err := s.mainCurrency(ctx, user)
	if err != nil {
		return nil, err
	}
	start := monthStart(month)
	end := start.AddDate(0, 1, 0)
	v := &BudgetView{Month: start.Format("2006-01"), Currency: cur, Connected: connected, Budgets: []Budget{}, Suggestions: []CategorySpend{},
		DaysInMonth: end.AddDate(0, 0, -1).Day()}
	if start.Equal(monthStart(today)) {
		v.DayOfMonth = today.Day()
	}
	if v.ByCategory, v.SpentCents, err = s.spending(ctx, user, cur, start, end); err != nil {
		return nil, err
	}
	spent := map[string]int64{}
	for _, c := range v.ByCategory {
		spent[c.Category] = c.Cents
	}

	rows, err := s.pool.Query(ctx, `SELECT category, amount_cents FROM fin_budgets WHERE user_id = $1 ORDER BY amount_cents DESC`, user)
	if err != nil {
		return nil, err
	}
	var sum int64
	for rows.Next() {
		var b Budget
		if err := rows.Scan(&b.Category, &b.AmountCents); err != nil {
			rows.Close()
			return nil, err
		}
		if b.Category == "TOTAL" {
			b.SpentCents = v.SpentCents
			v.Overall = &b
			continue
		}
		b.SpentCents = spent[b.Category]
		sum += b.AmountCents
		v.Budgets = append(v.Budgets, b)
	}
	rows.Close()
	v.TotalCents = sum
	if v.Overall != nil {
		v.TotalCents = v.Overall.AmountCents
	}

	// Suggestions for categories without a budget: the monthly average of the
	// last 3 full months, rounded up to $10.
	sug, err := s.suggest(ctx, user, cur, monthStart(today))
	if err != nil {
		return nil, err
	}
	has := map[string]bool{}
	for _, b := range v.Budgets {
		has[b.Category] = true
	}
	for _, c := range sug {
		if !has[c.Category] {
			v.Suggestions = append(v.Suggestions, c)
		}
	}
	return v, nil
}

func (s *Service) suggest(ctx context.Context, user, cur string, thisMonth time.Time) ([]CategorySpend, error) {
	cats, _, err := s.spending(ctx, user, cur, thisMonth.AddDate(0, -3, 0), thisMonth)
	if err != nil {
		return nil, err
	}
	// Average over the months that actually have data (a new connection may have fewer).
	var months int
	if err := s.pool.QueryRow(ctx, `SELECT count(DISTINCT date_trunc('month', date)) FROM fin_transactions
		WHERE user_id = $1 AND date >= $2 AND date < $3`, user, thisMonth.AddDate(0, -3, 0), thisMonth).Scan(&months); err != nil {
		return nil, err
	}
	if months == 0 {
		return []CategorySpend{}, nil
	}
	out := []CategorySpend{}
	for _, c := range cats {
		if !Budgetable[c.Category] {
			continue
		}
		avg := c.Cents / int64(months)
		if avg < 1000 { // under $10 a month: not worth a budget
			continue
		}
		out = append(out, CategorySpend{Category: c.Category, Cents: roundUp(avg, 1000)})
	}
	return out, nil
}

func roundUp(cents, step int64) int64 { return int64(math.Ceil(float64(cents)/float64(step))) * step }

// SetBudget creates or changes one monthly budget.
func (s *Service) SetBudget(ctx context.Context, user, category string, amountCents int64) error {
	if !Budgetable[category] {
		return fmt.Errorf("%w: unknown category", ErrInvalid)
	}
	if amountCents <= 0 || amountCents > 100_000_000_000 {
		return fmt.Errorf("%w: enter an amount above zero", ErrInvalid)
	}
	cur, _, err := s.mainCurrency(ctx, user)
	if err != nil {
		return err
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM fin_budgets WHERE user_id = $1 AND category <> $2`, user, category).Scan(&n); err != nil {
		return err
	}
	if n >= len(Budgetable) {
		return fmt.Errorf("%w: too many budgets", ErrInvalid)
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO fin_budgets (user_id, category, amount_cents, currency) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, category) DO UPDATE SET amount_cents = $3, currency = $4, updated_at = now()`, user, category, amountCents, cur)
	return err
}

// PlanBudget is one monthly budget in a plan Mayele proposed in chat.
type PlanBudget struct {
	Category    string `json:"category"`
	AmountCents int64  `json:"amount_cents"`
}

// ApplyPlan creates or changes several budgets at once (all or nothing).
func (s *Service) ApplyPlan(ctx context.Context, user string, plan []PlanBudget) (int, error) {
	if len(plan) == 0 || len(plan) > len(Budgetable) {
		return 0, fmt.Errorf("%w: the plan has no budgets", ErrInvalid)
	}
	seen := map[string]bool{}
	for _, b := range plan {
		if !Budgetable[b.Category] || seen[b.Category] {
			return 0, fmt.Errorf("%w: unknown category", ErrInvalid)
		}
		if b.AmountCents <= 0 || b.AmountCents > 100_000_000_000 {
			return 0, fmt.Errorf("%w: enter an amount above zero", ErrInvalid)
		}
		seen[b.Category] = true
	}
	cur, _, err := s.mainCurrency(ctx, user)
	if err != nil {
		return 0, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	for _, b := range plan {
		if _, err := tx.Exec(ctx, `INSERT INTO fin_budgets (user_id, category, amount_cents, currency) VALUES ($1, $2, $3, $4)
			ON CONFLICT (user_id, category) DO UPDATE SET amount_cents = $3, currency = $4, updated_at = now()`, user, b.Category, b.AmountCents, cur); err != nil {
			return 0, err
		}
	}
	return len(plan), tx.Commit(ctx)
}

func (s *Service) DeleteBudget(ctx context.Context, user, category string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM fin_budgets WHERE user_id = $1 AND category = $2`, user, category)
	return err
}

// ApplySuggestions creates budgets from recent spending for every category
// that has none, cut by cutPercent (0, 10 or 20) to help save.
func (s *Service) ApplySuggestions(ctx context.Context, user string, today time.Time, cutPercent int) (int, error) {
	if cutPercent != 0 && cutPercent != 10 && cutPercent != 20 {
		return 0, fmt.Errorf("%w: cut must be 0, 10 or 20", ErrInvalid)
	}
	cur, _, err := s.mainCurrency(ctx, user)
	if err != nil {
		return 0, err
	}
	sug, err := s.suggest(ctx, user, cur, monthStart(today))
	if err != nil {
		return 0, err
	}
	n := 0
	for _, c := range sug {
		amount := roundUp(c.Cents*int64(100-cutPercent)/100, 1000)
		tag, err := s.pool.Exec(ctx, `INSERT INTO fin_budgets (user_id, category, amount_cents, currency) VALUES ($1, $2, $3, $4)
			ON CONFLICT (user_id, category) DO NOTHING`, user, c.Category, amount, cur)
		if err != nil {
			return n, err
		}
		n += int(tag.RowsAffected())
	}
	return n, nil
}
