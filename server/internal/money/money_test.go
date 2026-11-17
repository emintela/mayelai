package money

import (
	"testing"
	"time"
)

func TestParseAmount(t *testing.T) {
	ok := map[string]int64{"200": 20000, "200.5": 20050, "200.50": 20050, "0.01": 1, "1,200.00": 120000,
		"200,50": 20050, " 15 ": 1500, "1000000": 100000000}
	for in, want := range ok {
		if got, err := ParseAmount(in); err != nil || got != want {
			t.Errorf("ParseAmount(%q) = %d, %v; want %d", in, got, err, want)
		}
	}
	for _, in := range []string{"", "0", "0.00", "-5", "abc", "1.234", "1000000.01", "12e3", "$200"} {
		if _, err := ParseAmount(in); err == nil {
			t.Errorf("ParseAmount(%q) accepted", in)
		}
	}
}

func TestValidateNewLoan(t *testing.T) {
	today := time.Date(2026, 11, 17, 0, 0, 0, 0, time.UTC)
	base := NewLoan{Direction: "lent", CounterpartyName: "Patrick", Amount: "200", Currency: "usd"}
	v, err := base.validate(today)
	if err != nil || v.cents != 20000 || v.currency != "USD" || v.lang != "fr" || !v.lentOn.Equal(today) {
		t.Fatalf("valid loan: %+v %v", v, err)
	}
	bad := []func(*NewLoan){
		func(n *NewLoan) { n.Direction = "gave" },
		func(n *NewLoan) { n.CounterpartyName = "  " },
		func(n *NewLoan) { n.Currency = "CDF" },
		func(n *NewLoan) { n.Amount = "0" },
		func(n *NewLoan) { n.LentOn = "2026-12-30" }, // future
		func(n *NewLoan) { n.LentOn = "2026-11-10"; n.DueOn = "2026-11-01" },
		func(n *NewLoan) { n.DueOn = "30/11/2026" },
		func(n *NewLoan) { n.CounterpartyPhone = "call me" },
		func(n *NewLoan) { n.ReminderLanguage = "ln" }, // coming soon
	}
	for i, mutate := range bad {
		n := base
		mutate(&n)
		if _, err := n.validate(today); err == nil {
			t.Errorf("case %d accepted: %+v", i, n)
		}
	}
}

func TestSanitizeDraft(t *testing.T) {
	d := sanitizeDraft(Draft{Direction: "stole", CounterpartyName: " Patrick ", Amount: "two hundred",
		Currency: "CDF", LentOn: "yesterday", DueOn: "2026-11-30"})
	if d.Direction != "lent" || d.CounterpartyName != "Patrick" || d.Amount != "" || d.Currency != "" ||
		d.LentOn != "" || d.DueOn != "2026-11-30" {
		t.Fatalf("sanitize: %+v", d)
	}
}
