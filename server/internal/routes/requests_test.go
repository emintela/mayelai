package routes

import (
	"fmt"
	"testing"
	"time"
)

func TestMoneyRequests(t *testing.T) {
	app, _, _, pushes := moneyAppWithPush(t, 0, 0)
	sub := func(user, endpoint string) {
		body := fmt.Sprintf(`{"lang":"en","subscription":{"endpoint":%q,"keys":{"p256dh":"BNcR","auth":"tBHI"}}}`, endpoint)
		if st, _ := req(t, app, "POST", "/api/push/subscribe", user, body); st != 200 {
			t.Fatalf("subscribe %s: %d", user, st)
		}
	}
	sub("alice", "https://push.example/alice")
	sub("bob", "https://push.example/bob")
	if st, _ := req(t, app, "POST", "/api/push/subscribe", "bob", `{"subscription":{"endpoint":"http://x","keys":{"p256dh":"a","auth":"b"}}}`); st != 400 {
		t.Fatalf("bad subscription accepted: %d", st)
	}

	// Alice asks Bob to borrow $50, to pay back next month.
	due := time.Now().AddDate(0, 1, 0).Format("2006-01-02")
	st, out := req(t, app, "POST", "/api/money/requests", "alice",
		`{"kind":"borrow","owner_name":"Alice","recipients":[{"name":"Bob","phone":"+1 416 555 0199"}],"amount":"50","currency":"USD","note":"School fees","due_on":"`+due+`"}`)
	if st != 201 {
		t.Fatalf("create: %d %+v", st, out)
	}
	r := out["requests"].([]any)[0].(map[string]any)
	id, token := r["id"].(string), r["share_token"].(string)
	if r["status"] != "pending" || r["linked"] != false || r["amount_cents"].(float64) != 5000 {
		t.Fatalf("new request: %+v", r)
	}
	pub := "/api/public/requests/" + token

	// The public view shows Alice's pay handles once she has some, never Bob's phone.
	if _, p := req(t, app, "GET", pub, "", ""); p["pay_to"] != nil || p["counterparty_phone"] != nil {
		t.Fatalf("public view leaks: %+v", p)
	}
	if st, p := req(t, app, "PUT", "/api/money/profile", "alice", `{"cashtag":"$alice","venmo":"@alice-k","paypal":"paypal.me/alicek","zelle":"","interac":"","mobile_money":""}`); st != 200 || p["cashtag"] != "alice" || p["venmo"] != "alice-k" || p["paypal"] != "alicek" {
		t.Fatalf("profile: %d %+v", st, p)
	}
	if st, _ := req(t, app, "PUT", "/api/money/profile", "alice", `{"cashtag":"a b"}`); st != 400 {
		t.Fatalf("bad cashtag accepted: %d", st)
	}
	if _, p := req(t, app, "GET", pub, "", ""); p["pay_to"].(map[string]any)["cashtag"] != "alice" || p["owner_name"] != "Alice" {
		t.Fatalf("pay_to: %+v", p)
	}

	// Bob opens the link signed in: it's linked to him; nobody else can take it.
	if st, c := req(t, app, "POST", "/api/money/requests/claim", "bob", `{"token":"`+token+`"}`); st != 200 || c["role"] != "counterparty" {
		t.Fatalf("bob claim: %d %+v", st, c)
	}
	if st, c := req(t, app, "POST", "/api/money/requests/claim", "alice", `{"token":"`+token+`"}`); st != 200 || c["role"] != "owner" {
		t.Fatalf("owner claim: %d %+v", st, c)
	}
	if st, _ := req(t, app, "POST", "/api/money/requests/claim", "carol", `{"token":"`+token+`"}`); st != 409 {
		t.Fatalf("carol claim: %d", st)
	}
	if _, l := req(t, app, "GET", "/api/money/requests", "bob", ""); len(l["for_me"].([]any)) != 1 || len(l["mine"].([]any)) != 0 {
		t.Fatalf("bob lists: %+v", l)
	}
	if st, _ := req(t, app, "GET", "/api/money/requests/"+id, "bob", ""); st != 404 {
		t.Fatalf("bob reads owner view: %d", st)
	}

	// Bob offers $30 instead; Alice accepts the offer.
	if st, p := req(t, app, "POST", pub+"/counter", "", `{"amount":"30","note":"I can do 30"}`); st != 200 || p["status"] != "countered" {
		t.Fatalf("counter: %d %+v", st, p)
	}
	pushes.waitFor(t, "Bob offered $30 instead of $50")
	if st, _ := req(t, app, "POST", pub+"/accept", "", `{}`); st != 409 {
		t.Fatalf("accept after counter: %d", st)
	}
	st, a := req(t, app, "POST", "/api/money/requests/"+id+"/accept_counter", "alice", "")
	if st != 200 || a["request"].(map[string]any)["status"] != "accepted" || a["request"].(map[string]any)["amount_cents"].(float64) != 3000 {
		t.Fatalf("accept counter: %d %+v", st, a)
	}
	pushes.waitFor(t, "Alice accepted your offer of $30")

	// Bob sends it by Zelle; Alice confirms. The borrow becomes a loan Alice owes.
	if st, p := req(t, app, "POST", pub+"/sent", "", `{"method":"Zelle"}`); st != 200 || p["status"] != "sent" || p["pay_to"] == nil {
		t.Fatalf("sent: %d %+v", st, p)
	}
	if m := pushes.waitFor(t, "Bob sent you $30"); m.URL != "/onsave/money/requests/"+id {
		t.Fatalf("sent push: %+v", m)
	}
	st, a = req(t, app, "POST", "/api/money/requests/"+id+"/received", "alice", "")
	ar := a["request"].(map[string]any)
	if st != 200 || ar["status"] != "received" || ar["loan_id"] == nil {
		t.Fatalf("received: %d %+v", st, a)
	}
	_, loans := req(t, app, "GET", "/api/money/loans", "alice", "")
	l := loans["loans"].([]any)[0].(map[string]any)
	if l["direction"] != "borrowed" || l["amount_cents"].(float64) != 3000 || l["response"] != "confirmed" || l["counterparty_name"] != "Bob" {
		t.Fatalf("loan from borrow: %+v", l)
	}
	if _, p := req(t, app, "GET", pub, "", ""); p["pay_to"] != nil {
		t.Fatalf("pay handles shown after it's settled: %+v", p)
	}
	if st, _ := req(t, app, "POST", "/api/money/requests/"+id+"/cancel", "alice", ""); st != 409 {
		t.Fatalf("cancel settled: %d", st)
	}

	// A new request to Bob's number (written differently) is linked to him right away.
	_, out = req(t, app, "POST", "/api/money/requests", "alice",
		`{"kind":"owed","owner_name":"Alice","recipients":[{"name":"Bobby","phone":"14165550199"}],"amount":"12.50","currency":"USD","note":"Pizza"}`)
	if r := out["requests"].([]any)[0].(map[string]any); r["linked"] != true {
		t.Fatalf("auto link: %+v", r)
	}
	pushes.waitFor(t, "Alice requests $12.50")

	// Split a $10 bill between Alice and 3 friends; then one declines.
	st, out = req(t, app, "POST", "/api/money/requests", "alice",
		`{"kind":"owed","owner_name":"Alice","recipients":[{"name":"A"},{"name":"B"},{"name":"C"}],"amount":"10","currency":"EUR","split":true,"include_me":true}`)
	parts := out["requests"].([]any)
	if st != 201 || len(parts) != 3 {
		t.Fatalf("split: %d %+v", st, out)
	}
	var sum float64
	for _, p := range parts {
		sum += p.(map[string]any)["amount_cents"].(float64)
	}
	if sum != 750 || parts[0].(map[string]any)["split_id"] == nil {
		t.Fatalf("split shares: %v %+v", sum, parts)
	}
	first := parts[0].(map[string]any)
	if _, g := req(t, app, "GET", "/api/money/requests/"+first["id"].(string), "alice", ""); len(g["split"].([]any)) != 3 {
		t.Fatalf("split parts: %+v", g)
	}
	if st, p := req(t, app, "POST", "/api/public/requests/"+first["share_token"].(string)+"/decline", "", `{"note":"Not this time"}`); st != 200 || p["status"] != "declined" || p["split"] != true {
		t.Fatalf("decline: %d %+v", st, p)
	}
	if st, _ := req(t, app, "POST", "/api/money/requests", "alice", `{"kind":"borrow","owner_name":"A","recipients":[{"name":"X"}],"amount":"10","currency":"USD","split":true}`); st != 400 {
		t.Fatalf("split a borrow: %d", st)
	}

	// A gift: already sent; the other person confirms with a thank-you.
	_, out = req(t, app, "POST", "/api/money/requests", "alice",
		`{"kind":"gift","owner_name":"Alice","recipients":[{"name":"Mama"}],"amount":"100","currency":"CAD","method":"Interac"}`)
	gift := out["requests"].([]any)[0].(map[string]any)
	if gift["status"] != "sent" {
		t.Fatalf("gift: %+v", gift)
	}
	gp := "/api/public/requests/" + gift["share_token"].(string)
	if st, _ := req(t, app, "POST", gp+"/accept", "", `{}`); st != 409 {
		t.Fatalf("accept a gift: %d", st)
	}
	if st, p := req(t, app, "POST", gp+"/received", "", `{"note":"Merci mon enfant"}`); st != 200 || p["status"] != "received" || p["thanks_note"] != "Merci mon enfant" {
		t.Fatalf("gift received: %d %+v", st, p)
	}
	if m := pushes.waitFor(t, "Mama received your CA$100"); m.Body != "Merci mon enfant" {
		t.Fatalf("thanks push: %+v", m)
	}

	// Other people can't act on Alice's requests.
	if st, _ := req(t, app, "POST", "/api/money/requests/"+id+"/cancel", "bob", ""); st != 404 {
		t.Fatalf("bob cancels: %d", st)
	}
	if st, _ := req(t, app, "GET", "/api/public/requests/short", "", ""); st != 404 {
		t.Fatalf("bad token: %d", st)
	}
}
