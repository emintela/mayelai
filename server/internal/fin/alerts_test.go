package fin

import (
	"context"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAlerts(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	s.now = func() time.Time { return time.Date(2026, 11, 6, 15, 0, 0, 0, time.UTC) }
	var mu sync.Mutex
	var sent []string
	s.WithNotifier(func(user string, a Alert, _ AlertSettings) {
		mu.Lock()
		sent = append(sent, user+":"+a.Kind+":"+a.Category+a.Name)
		mu.Unlock()
	})

	if set, _ := s.AlertSettings(ctx, "alice"); !set.Budget || set.LargeCents != 50000 || set.SMS {
		t.Fatalf("defaults: %+v", set)
	}
	// $20 counts as large; under $7,000 in the bank is low. Texts can't be turned on yet.
	set, err := s.SaveAlertSettings(ctx, "alice", AlertSettings{Budget: true, LowBalance: true, LowCents: 700000, Large: true, LargeCents: 2000, Bills: true, SMS: true}, false)
	if err != nil || set.SMS {
		t.Fatalf("save: %+v %v", set, err)
	}
	if _, err := s.SaveAlertSettings(ctx, "alice", AlertSettings{LargeCents: 1}, false); err == nil {
		t.Fatal("bad amount accepted")
	}
	_ = s.SetBudget(ctx, "alice", "FOOD_AND_DRINK", 5000)

	if err := s.Connect(ctx, "alice", "public-sandbox-x", "ins_1", "Bank"); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"alice:large_charge:Uber",        // $25.10 on Nov 3
		"alice:large_charge:Whole Foods", // $80 on Nov 5 (the $300 card payment and payroll don't count)
		"alice:low_balance:",             // $6,100 in the bank
		"alice:over_budget:FOOD_AND_DRINK",
	}
	got := func() string {
		mu.Lock()
		defer mu.Unlock()
		x := append([]string(nil), sent...)
		sort.Strings(x)
		return strings.Join(x, " ")
	}
	if got() != strings.Join(want, " ") {
		t.Fatalf("alerts:\n got %s\nwant %s", got(), strings.Join(want, " "))
	}

	// A Netflix charge every month: the next one is due Nov 8, in 2 days.
	for i, d := range []string{"2026-09-08", "2026-10-08"} {
		_, err := s.pool.Exec(ctx, `INSERT INTO fin_transactions (plaid_transaction_id, item_id, user_id, plaid_account_id, date, name, merchant_name, amount_cents, category)
			SELECT $1, id, 'alice', 'chk', $2::date, 'Netflix', 'Netflix', 1799, 'ENTERTAINMENT' FROM fin_items`, "nf"+string(rune('0'+i)), d)
		if err != nil {
			t.Fatal(err)
		}
	}
	// Syncing again: only the new bill alert, nothing repeated.
	if err := s.Refresh(ctx, "alice", 0); err != nil {
		t.Fatal(err)
	}
	want = append(want, "alice:bill_due:ENTERTAINMENTNetflix")
	sort.Strings(want)
	if got() != strings.Join(want, " ") {
		t.Fatalf("after second sync:\n got %s\nwant %s", got(), strings.Join(want, " "))
	}

	list, unread, err := s.Alerts(ctx, "alice")
	if err != nil || len(list) != 5 || unread != 5 {
		t.Fatalf("list: %d unread %d %v", len(list), unread, err)
	}
	for _, a := range list {
		if a.Kind == "large_charge" && a.Name == "Uber" && a.AmountCents != 2510 {
			t.Fatalf("uber: %+v", a)
		}
	}
	_ = s.MarkAlertsRead(ctx, "alice")
	if _, unread, _ := s.Alerts(ctx, "alice"); unread != 0 {
		t.Fatalf("unread after read: %d", unread)
	}
	if other, _, _ := s.Alerts(ctx, "bob"); len(other) != 0 {
		t.Fatalf("bob sees alice's alerts")
	}

	// Switched off: no more alerts of that kind.
	mu.Lock()
	sent = nil
	mu.Unlock()
	_, _ = s.pool.Exec(ctx, `DELETE FROM fin_alerts`)
	_, _ = s.SaveAlertSettings(ctx, "alice", AlertSettings{Budget: false, LowBalance: false, LowCents: 0, Large: false, LargeCents: 50000, Bills: false}, false)
	_ = s.Refresh(ctx, "alice", 0)
	if g := got(); g != "" {
		t.Fatalf("alerts while off: %s", g)
	}
}
