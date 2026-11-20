package fin

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestBudgetsAndTips(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	today := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)

	// Before any bank: budgets work but there is nothing spent, and tips are the basics.
	if v, err := s.Budgets(ctx, "alice", today, today); err != nil || v.Connected || v.SpentCents != 0 {
		t.Fatalf("empty: %+v %v", v, err)
	}
	if tips, _ := s.Tips(ctx, "alice", today); len(tips.Tips) != 3 || tips.Tips[0].Tone != "info" {
		t.Fatalf("basics: %+v", tips)
	}

	if err := s.Connect(ctx, "alice", "public-sandbox-x", "ins_1", "Bank"); err != nil {
		t.Fatal(err)
	}
	// Suggestions come from October only (the one month with data): Starbucks $40, $999 shopping.
	v, err := s.Budgets(ctx, "alice", today, today)
	if err != nil {
		t.Fatal(err)
	}
	if len(v.Suggestions) != 2 || v.Suggestions[0].Category != "GENERAL_MERCHANDISE" || v.Suggestions[0].Cents != 100000 || v.Suggestions[1].Cents != 4000 {
		t.Fatalf("suggestions: %+v", v.Suggestions)
	}
	if tips, _ := s.Tips(ctx, "alice", today); !hasTip(tips.Tips, "make_budget") {
		t.Fatalf("no make_budget tip: %v", tips.Tips)
	}

	// "Spend 10% less": $900 shopping, food $36 rounds back up to $40.
	if n, err := s.ApplySuggestions(ctx, "alice", today, 10); err != nil || n != 2 {
		t.Fatalf("apply: %d %v", n, err)
	}
	if n, _ := s.ApplySuggestions(ctx, "alice", today, 10); n != 0 {
		t.Fatalf("applied twice: %d", n)
	}
	if _, err := s.ApplySuggestions(ctx, "alice", today, 15); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cut 15 accepted: %v", err)
	}
	if err := s.SetBudget(ctx, "alice", "TOTAL", 20000); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []struct {
		cat   string
		cents int64
	}{{"INCOME", 1000}, {"FOOD_AND_DRINK", 0}, {"FOOD_AND_DRINK", -5}} {
		if err := s.SetBudget(ctx, "alice", bad.cat, bad.cents); !errors.Is(err, ErrInvalid) {
			t.Fatalf("bad budget %v accepted: %v", bad, err)
		}
	}

	v, _ = s.Budgets(ctx, "alice", today, today)
	got := map[string]Budget{}
	for _, b := range v.Budgets {
		got[b.Category] = b
	}
	if got["GENERAL_MERCHANDISE"].AmountCents != 90000 || got["FOOD_AND_DRINK"].AmountCents != 4000 || got["FOOD_AND_DRINK"].SpentCents != 8000 {
		t.Fatalf("budgets: %+v", v.Budgets)
	}
	if v.Overall == nil || v.TotalCents != 20000 || v.Overall.SpentCents != 10510 || v.DayOfMonth != 10 || v.DaysInMonth != 30 {
		t.Fatalf("overall: %+v total %d", v.Overall, v.TotalCents)
	}
	if len(v.Suggestions) != 0 {
		t.Fatalf("suggestions left: %+v", v.Suggestions)
	}
	// Last month's view: October's spending, no "today" marker.
	oct, _ := s.Budgets(ctx, "alice", ParseMonth("2026-10", today), today)
	if oct.SpentCents != 103900 || oct.DayOfMonth != 0 || oct.Month != "2026-10" {
		t.Fatalf("october: %+v", oct)
	}
	if ParseMonth("2027-01", today).Month() != time.November || ParseMonth("junk", today).Month() != time.November {
		t.Fatal("future or junk month accepted")
	}

	tips, err := s.Tips(ctx, "alice", today)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"over_budget", "ahead_of_pace", "top_category", "save_left"} {
		if !hasTip(tips.Tips, want) {
			t.Fatalf("missing %s in %v", want, tips.Tips)
		}
	}
	// Last month at this date was only $40: too small to call spending "up".
	if hasTip(tips.Tips, "spend_up") {
		t.Fatalf("spend_up on a $40 base: %v", tips.Tips)
	}
	if tips.Tips[0].Tone != "warn" || tips.Tips[len(tips.Tips)-1].Tone != "good" {
		t.Fatalf("order: %v", tips.Tips)
	}
	for _, x := range tips.Tips {
		if x.Kind == "over_budget" && (x.Category != "FOOD_AND_DRINK" || x.AmountCents != 4000) {
			t.Fatalf("over: %+v", x)
		}
	}

	if err := s.DeleteBudget(ctx, "alice", "FOOD_AND_DRINK"); err != nil {
		t.Fatal(err)
	}
	if v, _ := s.Budgets(ctx, "alice", today, today); len(v.Budgets) != 1 {
		t.Fatalf("after delete: %+v", v.Budgets)
	}
	if v, _ := s.Budgets(ctx, "bob", today, today); v.Overall != nil || len(v.Budgets) != 0 {
		t.Fatalf("bob sees alice's budgets: %+v", v)
	}
}

func TestRecurring(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	today := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	if err := s.Connect(ctx, "alice", "public-sandbox-x", "ins_1", "Bank"); err != nil {
		t.Fatal(err)
	}
	add := func(id, date, merchant string, cents int64, cat string) {
		_, err := s.pool.Exec(ctx, `INSERT INTO fin_transactions (plaid_transaction_id, item_id, user_id, plaid_account_id, date, name, merchant_name, amount_cents, category)
			SELECT $1, id, 'alice', 'chk', $2::date, $3, $3, $4, $5 FROM fin_items LIMIT 1`, id, date, merchant, cents, cat)
		if err != nil {
			t.Fatal(err)
		}
	}
	add("n1", "2026-09-14", "Netflix", 1799, "ENTERTAINMENT")
	add("n2", "2026-10-14", "Netflix", 1799, "ENTERTAINMENT")
	add("s1", "2026-10-02", "Spotify", 1199, "ENTERTAINMENT")
	add("s2", "2026-11-02", "Spotify", 1199, "ENTERTAINMENT")
	add("c1", "2026-09-20", "Concert", 9000, "ENTERTAINMENT") // once: not recurring
	add("g1", "2026-09-03", "Gym", 3000, "PERSONAL_CARE")
	add("g2", "2026-10-03", "Gym", 9000, "PERSONAL_CARE") // amount changed a lot: not recurring

	rec, err := s.Recurring(ctx, "alice", "USD", today)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, r := range rec {
		names = append(names, r.Name)
	}
	if strings.Join(names, ",") != "Netflix,Spotify" {
		t.Fatalf("recurring: %v", names)
	}
	tips, _ := s.Tips(ctx, "alice", today)
	for _, x := range tips.Tips {
		if x.Kind == "subscriptions" && (x.Count != 2 || x.AmountCents != 2998) {
			t.Fatalf("subscriptions tip: %+v", x)
		}
	}
	if !hasTip(tips.Tips, "subscriptions") {
		t.Fatalf("no subscriptions tip: %v", tips.Tips)
	}
}

func hasTip(tips []Tip, kind string) bool {
	for _, x := range tips {
		if x.Kind == kind {
			return true
		}
	}
	return false
}

func TestSummary(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	today := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	if txt, err := s.Summary(ctx, "alice", today); err != nil || txt != "" {
		t.Fatalf("no bank: %q %v", txt, err)
	}
	if err := s.Connect(ctx, "alice", "public-sandbox-x", "ins_1", "Platypus"); err != nil {
		t.Fatal(err)
	}
	_ = s.SetBudget(ctx, "alice", "FOOD_AND_DRINK", 5000)
	txt, err := s.Summary(ctx, "alice", today)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"Platypus Plaid Checking (depository ••0000): balance 1,200.50 USD",
		"Net worth 5,790.25 USD",
		"spent 105.10 USD, income 2,500.00 USD",
		"- Food & dining: 80.00 USD / 50.00 USD",
		"LAST MONTH (October 2026): spent 1,039.00 USD",
		"2026-11-03 Uber 25.10 USD, Transportation",
	} {
		if !strings.Contains(txt, want) {
			t.Fatalf("summary is missing %q:\n%s", want, txt)
		}
	}
	if other, _ := s.Summary(ctx, "bob", today); other != "" {
		t.Fatalf("bob sees alice: %s", other)
	}
	if Amount(-123456789, "EUR") != "-1,234,567.89 EUR" || Amount(5, "USD") != "0.05 USD" {
		t.Fatalf("amount: %s %s", Amount(-123456789, "EUR"), Amount(5, "USD"))
	}
}
