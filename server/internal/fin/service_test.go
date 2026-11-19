package fin

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"mayelai/server/internal/testdb"
)

// fakePlaid answers like Plaid's sandbox for one bank.
type fakePlaid struct {
	mu      sync.Mutex
	calls   []string
	relink  bool
	removed bool
	page    int
}

func (f *fakePlaid) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	f.calls = append(f.calls, r.URL.Path)
	if body["client_id"] != "cid" || body["secret"] != "sec" {
		w.WriteHeader(400)
		_, _ = io.WriteString(w, `{"error_code":"INVALID_API_KEYS"}`)
		return
	}
	if f.relink && r.URL.Path != "/item/remove" && r.URL.Path != "/link/token/create" {
		w.WriteHeader(400)
		_, _ = io.WriteString(w, `{"error_type":"ITEM_ERROR","error_code":"ITEM_LOGIN_REQUIRED","error_message":"login required"}`)
		return
	}
	switch r.URL.Path {
	case "/link/token/create":
		if body["access_token"] != nil && body["access_token"] != "access-sandbox-1" {
			w.WriteHeader(400)
			return
		}
		_, _ = io.WriteString(w, `{"link_token":"link-sandbox-abc"}`)
	case "/item/public_token/exchange":
		_, _ = io.WriteString(w, `{"access_token":"access-sandbox-1","item_id":"item-1"}`)
	case "/accounts/get":
		_, _ = io.WriteString(w, `{"accounts":[
			{"account_id":"chk","name":"Plaid Checking","mask":"0000","type":"depository","subtype":"checking","balances":{"current":1200.50,"available":1100,"iso_currency_code":"USD"}},
			{"account_id":"sav","name":"Plaid Saving","mask":"1111","type":"depository","subtype":"savings","balances":{"current":5000,"iso_currency_code":"USD"}},
			{"account_id":"cc","name":"Plaid Credit Card","mask":"3333","type":"credit","subtype":"credit card","balances":{"current":410.25,"limit":2000,"iso_currency_code":"USD"}}]}`)
	case "/transactions/sync":
		// First sync: two pages. Next sync: one change and one removal.
		switch {
		case body["cursor"] == nil && f.page == 0:
			f.page++
			_, _ = io.WriteString(w, `{"added":[
				{"transaction_id":"t1","account_id":"chk","date":"2026-11-03","name":"UBER 063015","merchant_name":"Uber","amount":25.10,"iso_currency_code":"USD","personal_finance_category":{"primary":"TRANSPORTATION"}},
				{"transaction_id":"t2","account_id":"cc","date":"2026-11-05","name":"Whole Foods","merchant_name":"Whole Foods","amount":80,"iso_currency_code":"USD","personal_finance_category":{"primary":"FOOD_AND_DRINK"}},
				{"transaction_id":"t3","account_id":"chk","date":"2026-11-01","name":"Payroll","amount":-2500,"iso_currency_code":"USD","personal_finance_category":{"primary":"INCOME"}}
				],"modified":[],"removed":[],"next_cursor":"c1","has_more":true}`)
		case body["cursor"] == "c1":
			_, _ = io.WriteString(w, `{"added":[
				{"transaction_id":"t4","account_id":"chk","date":"2026-11-06","name":"CREDIT CARD PAYMENT","amount":300,"iso_currency_code":"USD","personal_finance_category":{"primary":"LOAN_PAYMENTS"}},
				{"transaction_id":"t5","account_id":"chk","date":"2026-10-04","name":"Starbucks","merchant_name":"Starbucks","amount":40,"iso_currency_code":"USD","personal_finance_category":{"primary":"FOOD_AND_DRINK"}},
				{"transaction_id":"t6","account_id":"chk","date":"2026-10-20","name":"Late in month","amount":999,"iso_currency_code":"USD","personal_finance_category":{"primary":"GENERAL_MERCHANDISE"}}
				],"modified":[],"removed":[],"next_cursor":"c2","has_more":false}`)
		default: // cursor c2
			_, _ = io.WriteString(w, `{"added":[],"modified":[
				{"transaction_id":"t1","account_id":"chk","date":"2026-11-03","name":"UBER 063015","merchant_name":"Uber","amount":30,"iso_currency_code":"USD","personal_finance_category":{"primary":"TRANSPORTATION"}}
				],"removed":[{"transaction_id":"t2"}],"next_cursor":"c3","has_more":false}`)
		}
	case "/item/remove":
		f.removed = true
		_, _ = io.WriteString(w, `{}`)
	default:
		w.WriteHeader(404)
	}
}

func newTestService(t *testing.T) (*Service, *fakePlaid) {
	pool, _ := testdb.New(t)
	fp := &fakePlaid{}
	srv := httptest.NewServer(fp)
	t.Cleanup(srv.Close)
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	s, err := New(pool, NewPlaid("cid", "sec", "sandbox").WithBase(srv.URL), base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	return s, fp
}

func TestFin(t *testing.T) {
	s, fp := newTestService(t)
	ctx := context.Background()
	today := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)

	if tok, err := s.LinkToken(ctx, "alice", "fr", ""); err != nil || tok != "link-sandbox-abc" {
		t.Fatalf("link token: %q %v", tok, err)
	}
	if err := s.Connect(ctx, "alice", "public-sandbox-x", "ins_109508", "First Platypus Bank"); err != nil {
		t.Fatal(err)
	}

	// The access token is stored encrypted.
	var box []byte
	if err := s.pool.QueryRow(ctx, `SELECT access_token FROM fin_items`).Scan(&box); err != nil || strings.Contains(string(box), "access-sandbox") {
		t.Fatalf("token stored in clear: %v", err)
	}

	o, err := s.Overview(ctx, "alice", today)
	if err != nil {
		t.Fatal(err)
	}
	if len(o.Banks) != 1 || o.Banks[0].InstitutionName != "First Platypus Bank" || len(o.Banks[0].Accounts) != 3 {
		t.Fatalf("banks: %+v", o.Banks)
	}
	// 1200.50 + 5000 cash, 410.25 owed.
	if o.CashCents != 620050 || o.OwedCents != 41025 || o.NetCents != 579025 || o.Currency != "USD" {
		t.Fatalf("totals: cash %d owed %d net %d", o.CashCents, o.OwedCents, o.NetCents)
	}
	// November: Uber 25.10 + Whole Foods 80 (payroll and the card payment don't count).
	if o.Month.SpentCents != 10510 || o.Month.IncomeCents != 250000 {
		t.Fatalf("month: %+v", o.Month)
	}
	// Last month up to Oct 10: only Starbucks (Oct 20 is later in the month).
	if o.Month.LastMonthCents != 4000 {
		t.Fatalf("last month: %d", o.Month.LastMonthCents)
	}
	if len(o.Month.ByCategory) != 2 || o.Month.ByCategory[0].Category != "FOOD_AND_DRINK" {
		t.Fatalf("categories: %+v", o.Month.ByCategory)
	}
	if len(o.Recent) != 6 || o.Recent[0].Date != "2026-11-06" {
		t.Fatalf("recent: %+v", o.Recent)
	}

	// Filters.
	food, _ := s.Transactions(ctx, "alice", TxnQuery{Category: "FOOD_AND_DRINK"})
	uber, _ := s.Transactions(ctx, "alice", TxnQuery{Search: "ub"})
	if len(food) != 2 || len(uber) != 1 || uber[0].AccountName != "Plaid Checking" {
		t.Fatalf("filters: food %d uber %+v", len(food), uber)
	}
	cc := o.Banks[0].Accounts[0] // sorted by type: credit first
	byAcct, _ := s.Transactions(ctx, "alice", TxnQuery{AccountID: cc.ID.String()})
	if cc.Type != "credit" || len(byAcct) != 1 {
		t.Fatalf("account filter: %s %d", cc.Type, len(byAcct))
	}
	if other, _ := s.Overview(ctx, "bob", today); len(other.Banks) != 0 || len(other.Recent) != 0 {
		t.Fatalf("bob sees alice's data: %+v", other)
	}

	// Refresh: skipped when fresh, then applies changes and removals.
	n := len(fp.calls)
	_ = s.Refresh(ctx, "alice", time.Hour)
	if len(fp.calls) != n {
		t.Fatal("refreshed a fresh connection")
	}
	_ = s.Refresh(ctx, "alice", 0)
	o, _ = s.Overview(ctx, "alice", today)
	if o.Month.SpentCents != 3000 { // Uber now 30, Whole Foods removed
		t.Fatalf("after sync: %d", o.Month.SpentCents)
	}

	// The bank wants a new sign-in: marked, and Link can reopen it.
	fp.relink = true
	_ = s.Refresh(ctx, "alice", 0)
	o, _ = s.Overview(ctx, "alice", today)
	if o.Banks[0].Status != "relink" {
		t.Fatalf("status: %s", o.Banks[0].Status)
	}
	if tok, err := s.LinkToken(ctx, "alice", "en", o.Banks[0].ID.String()); err != nil || tok == "" {
		t.Fatalf("update-mode link: %v", err)
	}
	if _, err := s.LinkToken(ctx, "bob", "en", o.Banks[0].ID.String()); err != ErrNotFound {
		t.Fatalf("bob reopened alice's bank: %v", err)
	}

	// Disconnect: only the owner; everything is deleted and Plaid is told.
	if err := s.Disconnect(ctx, "bob", o.Banks[0].ID.String()); err != ErrNotFound {
		t.Fatalf("bob disconnect: %v", err)
	}
	if err := s.Disconnect(ctx, "alice", o.Banks[0].ID.String()); err != nil || !fp.removed {
		t.Fatalf("disconnect: %v %v", err, fp.removed)
	}
	var left int
	_ = s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM fin_accounts) + (SELECT count(*) FROM fin_transactions)`).Scan(&left)
	if left != 0 {
		t.Fatalf("rows left: %d", left)
	}
}

func TestSealer(t *testing.T) {
	if _, err := newSealer("short"); err == nil {
		t.Fatal("bad key accepted")
	}
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	s, _ := newSealer(key)
	box := s.seal("access-production-123")
	if got, err := s.open(box); err != nil || got != "access-production-123" {
		t.Fatalf("round trip: %q %v", got, err)
	}
	box[len(box)-1] ^= 1
	if _, err := s.open(box); err == nil {
		t.Fatal("tampered token opened")
	}
}
