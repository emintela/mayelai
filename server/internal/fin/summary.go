package fin

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Readable names for Plaid's categories (for the AI).
var categoryNames = map[string]string{
	"FOOD_AND_DRINK": "Food & dining", "RENT_AND_UTILITIES": "Housing & bills", "TRANSPORTATION": "Transportation",
	"GENERAL_MERCHANDISE": "Shopping", "ENTERTAINMENT": "Entertainment", "PERSONAL_CARE": "Personal care",
	"MEDICAL": "Health", "TRAVEL": "Travel", "HOME_IMPROVEMENT": "Home", "GENERAL_SERVICES": "Services",
	"GOVERNMENT_AND_NON_PROFIT": "Taxes & giving", "BANK_FEES": "Bank fees", "LOAN_PAYMENTS": "Loan payments",
	"TRANSFER_IN": "Money in", "TRANSFER_OUT": "Money out", "INCOME": "Income", "OTHER": "Other", "TOTAL": "All spending",
}

func catName(c string) string {
	if n, ok := categoryNames[c]; ok {
		return n
	}
	return c
}

// Amount writes cents as "1,234.56 USD".
func Amount(cents int64, currency string) string {
	neg := cents < 0
	if neg {
		cents = -cents
	}
	whole, frac := cents/100, cents%100
	s := fmt.Sprint(whole)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	out := fmt.Sprintf("%s.%02d %s", s, frac, currency)
	if neg {
		return "-" + out
	}
	return out
}

// Summary describes the person's banks, spending and budgets in a few lines
// of plain text for "My Finances" chats. Empty when no bank is connected.
func (s *Service) Summary(ctx context.Context, user string, today time.Time) (string, error) {
	if s == nil {
		return "", nil
	}
	o, err := s.Overview(ctx, user, today)
	if err != nil || len(o.Banks) == 0 {
		return "", err
	}
	var b strings.Builder
	cur := o.Currency
	fmt.Fprintf(&b, "BANK ACCOUNTS (connected with Plaid, main currency %s):\n", cur)
	for _, bank := range o.Banks {
		for _, a := range bank.Accounts {
			bal := "unknown"
			if a.CurrentCents != nil {
				bal = Amount(*a.CurrentCents, a.Currency)
			}
			line := fmt.Sprintf("- %s %s (%s", bank.InstitutionName, a.Name, a.Type)
			if a.Mask != "" {
				line += " ••" + a.Mask
			}
			line += "): balance " + bal
			if a.Type == "credit" && a.LimitCents != nil {
				line += ", limit " + Amount(*a.LimitCents, a.Currency)
			}
			if a.AvailableCents != nil && a.Type == "depository" {
				line += ", available " + Amount(*a.AvailableCents, a.Currency)
			}
			b.WriteString(line + "\n")
		}
		if bank.Status == "relink" {
			fmt.Fprintf(&b, "- (%s needs the user to sign in again in AI Fin; its data may be old)\n", bank.InstitutionName)
		}
	}
	fmt.Fprintf(&b, "Net worth %s (cash and investments %s, owed on cards and loans %s).\n\n",
		Amount(o.NetCents, cur), Amount(o.CashCents, cur), Amount(o.OwedCents, cur))

	m := o.Month
	fmt.Fprintf(&b, "THIS MONTH (%s to %s): spent %s, income %s; same days last month: spent %s.\n",
		m.Start, today.Format("2006-01-02"), Amount(m.SpentCents, cur), Amount(m.IncomeCents, cur), Amount(m.LastMonthCents, cur))
	for _, c := range m.ByCategory {
		fmt.Fprintf(&b, "- %s: %s\n", catName(c.Category), Amount(c.Cents, cur))
	}

	// Last month in full, for comparison.
	lastStart := monthStart(today).AddDate(0, -1, 0)
	if cats, total, err := s.spending(ctx, user, cur, lastStart, monthStart(today)); err == nil && total > 0 {
		fmt.Fprintf(&b, "LAST MONTH (%s): spent %s.", lastStart.Format("January 2006"), Amount(total, cur))
		for i, c := range cats {
			if i == 6 {
				break
			}
			fmt.Fprintf(&b, " %s %s;", catName(c.Category), Amount(c.Cents, cur))
		}
		b.WriteString("\n")
	}

	if bv, err := s.Budgets(ctx, user, today, today); err == nil && (bv.Overall != nil || len(bv.Budgets) > 0) {
		b.WriteString("\nBUDGETS THIS MONTH (spent / budget):\n")
		if bv.Overall != nil {
			fmt.Fprintf(&b, "- All spending: %s / %s\n", Amount(bv.Overall.SpentCents, cur), Amount(bv.Overall.AmountCents, cur))
		}
		for _, x := range bv.Budgets {
			fmt.Fprintf(&b, "- %s: %s / %s\n", catName(x.Category), Amount(x.SpentCents, cur), Amount(x.AmountCents, cur))
		}
		fmt.Fprintf(&b, "(Day %d of %d.)\n", bv.DayOfMonth, bv.DaysInMonth)
	} else {
		b.WriteString("\nBUDGETS: none set yet (they can create them in Budgets, also from their spending in one tap).\n")
	}

	if rec, err := s.Recurring(ctx, user, cur, today); err == nil && len(rec) > 0 {
		b.WriteString("\nRECURRING PAYMENTS (seen at least 2 of the last 3 months):\n")
		for _, r := range rec {
			fmt.Fprintf(&b, "- %s about %s a month (%s)\n", r.Name, Amount(r.MonthlyCents, cur), catName(r.Category))
		}
	}

	if txns, err := s.Transactions(ctx, user, TxnQuery{Limit: 30}); err == nil && len(txns) > 0 {
		b.WriteString("\nLAST 30 TRANSACTIONS (positive = money out):\n")
		for _, t := range txns {
			name := t.Merchant
			if name == "" {
				name = t.Name
			}
			p := ""
			if t.Pending {
				p = " (pending)"
			}
			fmt.Fprintf(&b, "- %s %s %s, %s%s\n", t.Date, clip(name, 40), Amount(t.AmountCents, t.Currency), catName(t.Category), p)
		}
	}
	return b.String(), nil
}
