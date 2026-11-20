package routes

import (
	"context"
	"fmt"
	"strings"
	"time"

	"mayelai/server/internal/fin"
	"mayelai/server/internal/money"
)

// FinanceContext is what Mayele sees in "My Finances" chats: banks, spending
// and budgets (AI Fin) plus onSave groups, loans and open money requests.
func FinanceContext(finSvc *fin.Service, m *money.Store) func(ctx context.Context, user string) (string, error) {
	return func(ctx context.Context, user string) (string, error) {
		now := time.Now().UTC()
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		var b strings.Builder
		fmt.Fprintf(&b, "Today is %s.\n\n", today.Format("Monday 2 January 2006"))

		banks, err := finSvc.Summary(ctx, user, today)
		if err != nil {
			return "", err
		}
		if banks == "" {
			b.WriteString("BANK ACCOUNTS: none connected (they can connect one in AI Fin to get spending insights).\n")
		} else {
			b.WriteString(banks)
		}
		if m != nil {
			b.WriteString(onSaveSummary(ctx, m, user, today))
		}
		return b.String(), nil
	}
}

func onSaveSummary(ctx context.Context, m *money.Store, user string, today time.Time) string {
	var b strings.Builder
	if groups, err := m.MyGroups(ctx, user); err == nil {
		live := 0
		for _, g := range groups {
			if g.Status != "forming" && g.Status != "active" {
				continue
			}
			if live == 0 {
				b.WriteString("\nONSAVE SAVINGS GROUPS (likelemba / tontine):\n")
			}
			live++
			fmt.Fprintf(&b, "- %q: %s per member, %s, %d members, pot %s, status %s, role %s",
				g.Name, fin.Amount(g.AmountCents, g.Currency), g.Frequency, g.MemberCount, fin.Amount(g.PotCents, g.Currency), g.Status, g.Role)
			if g.Status == "active" && g.CurrentRound >= 1 && g.CurrentRound <= len(g.Rounds) {
				r := g.Rounds[g.CurrentRound-1]
				fmt.Fprintf(&b, "; round %d of %d on %s goes to %s", r.Number, len(g.Rounds), r.Date.Format("2006-01-02"), r.RecipientName)
				if g.You != nil {
					paid := false
					for _, p := range r.Payments {
						if p.MemberID == g.You.ID && p.Status != "" {
							paid = true
						}
					}
					if r.RecipientID == g.You.ID {
						b.WriteString(" (that's the user: they receive this round)")
					} else if paid {
						b.WriteString(" (the user has paid this round)")
					} else {
						b.WriteString(" (the user still owes this round)")
					}
				}
			}
			if g.You != nil {
				for _, r := range g.Rounds {
					if r.RecipientID == g.You.ID && !r.PaidOut {
						fmt.Fprintf(&b, "; the user's payout: round %d on %s", r.Number, r.Date.Format("2006-01-02"))
					}
				}
			}
			b.WriteString("\n")
		}
	}
	if loans, err := m.List(ctx, user, "open"); err == nil && len(loans) > 0 {
		b.WriteString("\nOPEN LOANS (tracked in onSave Money):\n")
		for i, l := range loans {
			if i == 15 {
				break
			}
			who := "the user lent to " + l.CounterpartyName
			if l.Direction == "borrowed" {
				who = "the user borrowed from " + l.CounterpartyName
			}
			due := ""
			if l.DueOn != nil {
				due = ", due " + l.DueOn.Format("2006-01-02")
			}
			fmt.Fprintf(&b, "- %s: %s left of %s%s\n", who, fin.Amount(l.OutstandingCents, l.Currency), fin.Amount(l.AmountCents, l.Currency), due)
		}
	}
	open := map[string]bool{"pending": true, "countered": true, "accepted": true, "sent": true}
	var reqs []string
	if mine, err := m.MyRequests(ctx, user); err == nil {
		for _, r := range mine {
			if open[r.Status] && len(reqs) < 12 {
				reqs = append(reqs, fmt.Sprintf("- the user asked %s (%s) for %s, status %s", r.CounterpartyName, r.Kind, fin.Amount(r.AmountCents, r.Currency), r.Status))
			}
		}
	}
	if forMe, err := m.RequestsForMe(ctx, user); err == nil {
		for _, r := range forMe {
			if open[r.Status] && len(reqs) < 20 {
				reqs = append(reqs, fmt.Sprintf("- %s asked the user (%s) for %s, status %s", r.OwnerName, r.Kind, fin.Amount(r.AmountCents, r.Currency), r.Status))
			}
		}
	}
	if len(reqs) > 0 {
		b.WriteString("\nOPEN MONEY REQUESTS:\n" + strings.Join(reqs, "\n") + "\n")
	}
	if b.Len() == 0 {
		return "\nONSAVE: no savings groups, loans or open requests yet.\n"
	}
	return b.String()
}
