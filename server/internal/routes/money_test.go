package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/config"
	"mayelai/server/internal/db"
	"mayelai/server/internal/money"
	"mayelai/server/internal/testdb"
)

type fakeAI struct{ calls int }

func (f *fakeAI) ParseLoan(ctx context.Context, text string, today time.Time) (*money.Draft, money.Usage, error) {
	f.calls++
	return &money.Draft{Direction: "lent", CounterpartyName: "Patrick", Amount: "200", Currency: "USD",
		DueOn: today.AddDate(0, 0, 13).Format("2006-01-02")}, money.Usage{PromptTokens: 10}, nil
}

func (f *fakeAI) ReminderDraft(ctx context.Context, in money.ReminderInput) (string, money.Usage, error) {
	f.calls++
	return fmt.Sprintf("[%s/%s] %s owes %s", in.Language, in.Tone, in.Borrower, in.Outstanding), money.Usage{}, nil
}

func (f *fakeAI) CollectionDraft(ctx context.Context, in money.CollectionInput) (string, money.Usage, error) {
	f.calls++
	if in.Purpose == "reminder" {
		return fmt.Sprintf("[%s] %s promised %s", in.Language, in.Person, in.Pledged), money.Usage{}, nil
	}
	return fmt.Sprintf("[%s] %s received of %s from %d", in.Language, in.Received, in.PledgedTotal, in.Givers), money.Usage{}, nil
}

func moneyApp(t *testing.T, freeLimit int, msgLimit int) (*fiber.App, *fakeAI, *db.Store) {
	_, url := testdb.New(t)
	ctx := context.Background()
	store, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	ai := &fakeAI{}
	cfg := config.Config{FreeOpenLoans: freeLimit, FreeOpenCollections: freeLimit, Free: config.Limits{Messages: msgLimit}}
	d := Deps{Store: store, Config: cfg, Money: money.NewStore(store.Pool()), MoneyAI: ai}

	app := fiber.New()
	// Test auth: X-Test-User stands in for a verified Clerk user.
	app.Use(func(c fiber.Ctx) error {
		if u := c.Get("X-Test-User"); u != "" {
			auth.SetUserID(c, u)
		}
		return c.Next()
	})
	registerPublicMoney(app, d)
	api := app.Group("/api", auth.Require())
	registerMoney(api, d, func(c fiber.Ctx) error { return c.Next() })
	return app, ai, store
}

func req(t *testing.T, app *fiber.App, method, path, user, body string) (int, map[string]any) {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	rq := httptest.NewRequest(method, path, r)
	rq.Header.Set("Content-Type", "application/json")
	if user != "" {
		rq.Header.Set("X-Test-User", user)
	}
	resp, err := app.Test(rq, fiber.TestConfig{Timeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

const newLoan = `{"owner_name":"Eddy","direction":"lent","counterparty_name":"Patrick","amount":"200","currency":"USD","due_on":"2099-01-01"}`

func TestMoneyLoanLifecycle(t *testing.T) {
	app, _, _ := moneyApp(t, 0, 0)

	st, l := req(t, app, "POST", "/api/money/loans", "alice", newLoan)
	if st != 201 || l["outstanding_cents"].(float64) != 20000 || l["status"] != "open" || len(l["share_token"].(string)) != 32 {
		t.Fatalf("create: %d %+v", st, l)
	}
	id := l["id"].(string)

	// Partial then full repayment closes the loan; overpaying is refused.
	st, l = req(t, app, "POST", "/api/money/loans/"+id+"/payments", "alice", `{"amount":"50","method":"Zelle"}`)
	if st != 200 || l["outstanding_cents"].(float64) != 15000 || l["status"] != "open" {
		t.Fatalf("partial: %d %+v", st, l)
	}
	if st, _ := req(t, app, "POST", "/api/money/loans/"+id+"/payments", "alice", `{"amount":"150.01"}`); st != 400 {
		t.Fatalf("overpay: %d", st)
	}
	st, l = req(t, app, "POST", "/api/money/loans/"+id+"/payments", "alice", `{"amount":"150"}`)
	if st != 200 || l["status"] != "paid" || l["outstanding_cents"].(float64) != 0 {
		t.Fatalf("full: %d %+v", st, l)
	}
	if st, _ := req(t, app, "POST", "/api/money/loans/"+id+"/payments", "alice", `{"amount":"1"}`); st != 409 {
		t.Fatalf("payment on paid loan: %d", st)
	}

	// Deleting a payment reopens it.
	payments := l["payments"].([]any)
	pid := payments[1].(map[string]any)["id"].(string)
	st, l = req(t, app, "DELETE", "/api/money/loans/"+id+"/payments/"+pid, "alice", "")
	if st != 200 || l["status"] != "open" || l["outstanding_cents"].(float64) != 15000 {
		t.Fatalf("delete payment: %d %+v", st, l)
	}

	// Forgive, then reopen.
	if st, l = req(t, app, "POST", "/api/money/loans/"+id+"/status", "alice", `{"status":"forgiven"}`); st != 200 || l["status"] != "forgiven" {
		t.Fatalf("forgive: %d %+v", st, l)
	}
	if st, _ = req(t, app, "PATCH", "/api/money/loans/"+id, "alice", `{"note":"x"}`); st != 409 {
		t.Fatalf("edit closed loan: %d", st)
	}
	if st, l = req(t, app, "POST", "/api/money/loans/"+id+"/status", "alice", `{"status":"open"}`); st != 200 || l["status"] != "open" {
		t.Fatalf("reopen: %d %+v", st, l)
	}

	// Edit, list, delete.
	if st, l = req(t, app, "PATCH", "/api/money/loans/"+id, "alice", `{"due_on":"","counterparty_phone":"+1 555 123 4567"}`); st != 200 || l["due_on"] != nil {
		t.Fatalf("patch: %d %+v", st, l)
	}
	if st, _ = req(t, app, "PATCH", "/api/money/loans/"+id, "alice", `{"owner_id":"bob"}`); st != 400 {
		t.Fatalf("unknown field: %d", st)
	}
	st, list := req(t, app, "GET", "/api/money/loans?status=open", "alice", "")
	if st != 200 || len(list["loans"].([]any)) != 1 {
		t.Fatalf("list: %d %+v", st, list)
	}
	if st, _ = req(t, app, "DELETE", "/api/money/loans/"+id, "alice", ""); st != 204 {
		t.Fatalf("delete: %d", st)
	}
	if st, _ = req(t, app, "GET", "/api/money/loans/"+id, "alice", ""); st != 404 {
		t.Fatalf("get deleted: %d", st)
	}
}

func TestMoneyIsolation(t *testing.T) {
	app, _, _ := moneyApp(t, 0, 0)
	_, l := req(t, app, "POST", "/api/money/loans", "alice", newLoan)
	id := l["id"].(string)

	if st, _ := req(t, app, "GET", "/api/money/loans", "", ""); st != 401 {
		t.Fatalf("anonymous list: %d", st)
	}
	for _, c := range []struct{ method, path, body string }{
		{"GET", "/api/money/loans/" + id, ""},
		{"PATCH", "/api/money/loans/" + id, `{"note":"hacked"}`},
		{"POST", "/api/money/loans/" + id + "/payments", `{"amount":"200"}`},
		{"POST", "/api/money/loans/" + id + "/status", `{"status":"cancelled"}`},
		{"POST", "/api/money/loans/" + id + "/link", ""},
		{"POST", "/api/money/loans/" + id + "/reminders", `{"channel":"copy","language":"fr","message":"x"}`},
		{"DELETE", "/api/money/loans/" + id, ""},
	} {
		if st, _ := req(t, app, c.method, c.path, "bob", c.body); st != 404 {
			t.Errorf("bob %s %s: %d, want 404", c.method, c.path, st)
		}
	}
	if _, list := req(t, app, "GET", "/api/money/loans", "bob", ""); len(list["loans"].([]any)) != 0 {
		t.Fatal("bob sees alice's loans")
	}
	if _, l := req(t, app, "GET", "/api/money/loans/"+id, "alice", ""); l["status"] != "open" || l["note"] != "" {
		t.Fatalf("alice's loan changed by bob: %+v", l)
	}
}

func TestMoneyFreeLimitConcurrent(t *testing.T) {
	app, _, _ := moneyApp(t, 3, 0)
	var wg sync.WaitGroup
	codes := make(chan int, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, _ := req(t, app, "POST", "/api/money/loans", "alice", newLoan)
			codes <- st
		}()
	}
	wg.Wait()
	close(codes)
	created, limited := 0, 0
	for c := range codes {
		switch c {
		case 201:
			created++
		case 403:
			limited++
		default:
			t.Fatalf("unexpected status %d", c)
		}
	}
	if created != 3 || limited != 5 {
		t.Fatalf("created %d, limited %d; want 3 and 5", created, limited)
	}
	st, body := req(t, app, "POST", "/api/money/loans", "alice", newLoan)
	if st != 403 || body["code"] != "limit_loans" || body["upgrade"] != true {
		t.Fatalf("limit response: %d %+v", st, body)
	}
	// Closing one frees a slot; reopening it while at the limit is refused.
	_, list := req(t, app, "GET", "/api/money/loans", "alice", "")
	first := list["loans"].([]any)[0].(map[string]any)["id"].(string)
	req(t, app, "POST", "/api/money/loans/"+first+"/status", "alice", `{"status":"cancelled"}`)
	if st, _ := req(t, app, "POST", "/api/money/loans", "alice", newLoan); st != 201 {
		t.Fatalf("create after closing one: %d", st)
	}
	if st, _ := req(t, app, "POST", "/api/money/loans/"+first+"/status", "alice", `{"status":"open"}`); st != 403 {
		t.Fatalf("reopen at limit: %d", st)
	}
}

func TestMoneySharedLink(t *testing.T) {
	app, _, _ := moneyApp(t, 0, 0)
	_, l := req(t, app, "POST", "/api/money/loans", "alice",
		`{"owner_name":"Eddy","direction":"lent","counterparty_name":"Patrick","counterparty_phone":"+243 81 234 5678","amount":"200","currency":"EUR","note":"loyer"}`)
	token, id := l["share_token"].(string), l["id"].(string)
	req(t, app, "POST", "/api/money/loans/"+id+"/payments", "alice", `{"amount":"20","note":"PRIVATE payment note"}`)

	st, pub := req(t, app, "GET", "/api/public/loans/"+token, "", "")
	if st != 200 || pub["owner_name"] != "Eddy" || pub["outstanding_cents"].(float64) != 18000 || pub["response"] != "pending" {
		t.Fatalf("public view: %d %+v", st, pub)
	}
	raw, _ := json.Marshal(pub)
	for _, secret := range []string{"+243", "PRIVATE", "share_token", "payments", "owner_id"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("public view leaks %q: %s", secret, raw)
		}
	}
	if st, pub = req(t, app, "POST", "/api/public/loans/"+token+"/respond", "", `{"response":"confirmed","note":"Merci, je paie le 30"}`); st != 200 || pub["response"] != "confirmed" {
		t.Fatalf("confirm: %d %+v", st, pub)
	}
	if _, l = req(t, app, "GET", "/api/money/loans/"+id, "alice", ""); l["response"] != "confirmed" || l["response_note"] != "Merci, je paie le 30" {
		t.Fatalf("owner sees response: %+v", l)
	}
	if st, _ = req(t, app, "POST", "/api/public/loans/"+token+"/respond", "", `{"response":"maybe"}`); st != 400 {
		t.Fatalf("bad response value: %d", st)
	}
	for _, bad := range []string{"nope", strings.Repeat("a", 32), token + "x"} {
		if st, _ := req(t, app, "GET", "/api/public/loans/"+bad, "", ""); st != 404 {
			t.Fatalf("bad token %q: %d", bad, st)
		}
	}
	// Rotating the link kills the old one and resets the response.
	_, l = req(t, app, "POST", "/api/money/loans/"+id+"/link", "alice", "")
	if l["share_token"] == token || l["response"] != "pending" {
		t.Fatalf("rotate: %+v", l)
	}
	if st, _ := req(t, app, "GET", "/api/public/loans/"+token, "", ""); st != 404 {
		t.Fatalf("old token still works: %d", st)
	}
	// Closed loans can't be responded to.
	newTok := l["share_token"].(string)
	req(t, app, "POST", "/api/money/loans/"+id+"/status", "alice", `{"status":"paid"}`)
	if st, _ := req(t, app, "POST", "/api/public/loans/"+newTok+"/respond", "", `{"response":"declined"}`); st != 409 {
		t.Fatalf("respond to closed loan: %d", st)
	}
}

func TestMoneyAIQuotaAndReminders(t *testing.T) {
	app, ai, _ := moneyApp(t, 0, 2)
	st, d := req(t, app, "POST", "/api/money/parse", "alice", `{"text":"J'ai prêté 200$ à Patrick jusqu'au 30"}`)
	if st != 200 || d["counterparty_name"] != "Patrick" || d["amount"] != "200" {
		t.Fatalf("parse: %d %+v", st, d)
	}
	_, l := req(t, app, "POST", "/api/money/loans", "alice", newLoan)
	id := l["id"].(string)

	if st, _ := req(t, app, "POST", "/api/money/loans/"+id+"/reminders/draft", "alice", `{"language":"ln","tone":"gentle"}`); st != 400 {
		t.Fatalf("lingala draft: %d", st)
	}
	st, r := req(t, app, "POST", "/api/money/loans/"+id+"/reminders/draft", "alice", `{"language":"fr","tone":"gentle"}`)
	if st != 200 || r["message"] != "[fr/gentle] Patrick owes 200.00 USD" {
		t.Fatalf("draft: %d %+v", st, r)
	}
	// Daily AI limit (2) reached: third AI call is refused without calling the model.
	calls := ai.calls
	st, r = req(t, app, "POST", "/api/money/parse", "alice", `{"text":"I lent Marie 50 euros"}`)
	if st != 429 || r["code"] != "limit_messages" || ai.calls != calls {
		t.Fatalf("quota: %d %+v calls %d->%d", st, r, calls, ai.calls)
	}

	st, l = req(t, app, "POST", "/api/money/loans/"+id+"/reminders", "alice", `{"channel":"whatsapp","language":"fr","message":"Salut Patrick"}`)
	if st != 200 || l["last_reminded_at"] == nil || len(l["reminders"].([]any)) != 1 {
		t.Fatalf("log reminder: %d %+v", st, l)
	}

	// Reminders are only for money you gave.
	_, b := req(t, app, "POST", "/api/money/loans", "bob", strings.Replace(newLoan, `"lent"`, `"borrowed"`, 1))
	if st, _ := req(t, app, "POST", "/api/money/loans/"+b["id"].(string)+"/reminders/draft", "bob", `{"language":"en","tone":"firm"}`); st != 409 {
		t.Fatalf("reminder on borrowed loan: %d", st)
	}
}
