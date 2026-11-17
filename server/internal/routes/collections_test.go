package routes

import (
	"encoding/json"
	"strings"
	"testing"
)

const newCollection = `{"owner_name":"Eddy","kind":"funeral","title":"Matanga ya Mama Thérèse","beneficiary":"Famille Mbuyi","currency":"USD","goal":"2000"}`

func TestCollectionsLifecycle(t *testing.T) {
	app, _, _ := moneyApp(t, 0, 0)
	st, col := req(t, app, "POST", "/api/money/collections", "alice", newCollection)
	if st != 201 || col["status"] != "open" || len(col["share_token"].(string)) != 32 {
		t.Fatalf("create: %d %+v", st, col)
	}
	id, token := col["id"].(string), col["share_token"].(string)

	// Public pledges: one pledged, one "already sent", one anonymous with hidden amount.
	for _, body := range []string{
		`{"name":"Patrick","phone":"+243 81 234 5678","amount":"100","message":"Courage à la famille"}`,
		`{"name":"Marie","amount":"50","sent":true,"method":"M-Pesa"}`,
		`{"name":"Jean","amount":"500","hide_name":true,"hide_amount":true}`,
	} {
		if st, _ := req(t, app, "POST", "/api/public/collections/"+token+"/pledge", "", body); st != 201 {
			t.Fatalf("pledge %s: %d", body, st)
		}
	}
	// The public can't mark money as received.
	if st, _ := req(t, app, "POST", "/api/public/collections/"+token+"/pledge", "", `{"name":"X","amount":"10","received":true}`); st != 400 {
		t.Fatalf("public received: %d", st)
	}
	// Organizer adds cash in hand.
	st, col = req(t, app, "POST", "/api/money/collections/"+id+"/contributions", "alice", `{"name":"Tonton Paul","amount":"200","received":true,"method":"Cash"}`)
	if st != 200 {
		t.Fatalf("organizer add: %d %+v", st, col)
	}
	tot := col["totals"].(map[string]any)
	if tot["pledged_cents"].(float64) != 85000 || tot["sent_cents"].(float64) != 5000 || tot["received_cents"].(float64) != 20000 || tot["count"].(float64) != 4 {
		t.Fatalf("totals: %+v", tot)
	}

	// Organizer confirms Marie's money.
	var marie string
	for _, c := range col["contributions"].([]any) {
		if c.(map[string]any)["name"] == "Marie" {
			marie = c.(map[string]any)["id"].(string)
		}
	}
	_, col = req(t, app, "POST", "/api/money/collections/"+id+"/contributions/"+marie+"/status", "alice", `{"status":"received"}`)
	if col["totals"].(map[string]any)["received_cents"].(float64) != 25000 {
		t.Fatalf("after confirming: %+v", col["totals"])
	}

	// Public view: no phones, hidden name/amount blanked server-side.
	st, pub := req(t, app, "GET", "/api/public/collections/"+token, "", "")
	raw, _ := json.Marshal(pub)
	if st != 200 || strings.Contains(string(raw), "+243") || strings.Contains(string(raw), "phone") ||
		strings.Contains(string(raw), "Jean") || strings.Contains(string(raw), "share_token") {
		t.Fatalf("public view leaks: %s", raw)
	}
	for _, c := range pub["contributions"].([]any) {
		m := c.(map[string]any)
		if m["name"] == "" && m["amount_cents"] != nil {
			t.Fatalf("hidden amount shown: %+v", m)
		}
	}
	// Organizer can hide all amounts.
	req(t, app, "PATCH", "/api/money/collections/"+id, "alice", `{"show_amounts":false}`)
	_, pub = req(t, app, "GET", "/api/public/collections/"+token, "", "")
	for _, c := range pub["contributions"].([]any) {
		if c.(map[string]any)["amount_cents"] != nil {
			t.Fatal("amount shown while show_amounts=false")
		}
	}

	// Closing stops pledges; reopening works; delete.
	req(t, app, "POST", "/api/money/collections/"+id+"/status", "alice", `{"status":"closed"}`)
	if st, _ := req(t, app, "POST", "/api/public/collections/"+token+"/pledge", "", `{"name":"Late","amount":"5"}`); st != 409 {
		t.Fatalf("pledge on closed: %d", st)
	}
	if st, col = req(t, app, "POST", "/api/money/collections/"+id+"/status", "alice", `{"status":"open"}`); st != 200 || col["status"] != "open" {
		t.Fatalf("reopen: %d", st)
	}
	// New link kills the old one.
	_, col = req(t, app, "POST", "/api/money/collections/"+id+"/link", "alice", "")
	if st, _ := req(t, app, "GET", "/api/public/collections/"+token, "", ""); st != 404 {
		t.Fatalf("old link still works: %d", st)
	}
	if st, _ := req(t, app, "DELETE", "/api/money/collections/"+id, "alice", ""); st != 204 {
		t.Fatalf("delete: %d", st)
	}
}

func TestCollectionsIsolationAndLimit(t *testing.T) {
	app, _, _ := moneyApp(t, 1, 0)
	_, col := req(t, app, "POST", "/api/money/collections", "alice", newCollection)
	id := col["id"].(string)
	_, col = req(t, app, "POST", "/api/money/collections/"+id+"/contributions", "alice", `{"name":"A","amount":"10"}`)
	cid := col["contributions"].([]any)[0].(map[string]any)["id"].(string)

	for _, c := range []struct{ method, path, body string }{
		{"GET", "/api/money/collections/" + id, ""},
		{"PATCH", "/api/money/collections/" + id, `{"title":"hacked"}`},
		{"POST", "/api/money/collections/" + id + "/contributions", `{"name":"B","amount":"10"}`},
		{"POST", "/api/money/collections/" + id + "/contributions/" + cid + "/status", `{"status":"received"}`},
		{"DELETE", "/api/money/collections/" + id + "/contributions/" + cid, ""},
		{"POST", "/api/money/collections/" + id + "/status", `{"status":"closed"}`},
		{"POST", "/api/money/collections/" + id + "/link", ""},
		{"DELETE", "/api/money/collections/" + id, ""},
	} {
		if st, _ := req(t, app, c.method, c.path, "bob", c.body); st != 404 {
			t.Errorf("bob %s %s: %d, want 404", c.method, c.path, st)
		}
	}
	// Free plan: one open collection.
	st, body := req(t, app, "POST", "/api/money/collections", "alice", newCollection)
	if st != 403 || body["code"] != "limit_collections" {
		t.Fatalf("limit: %d %+v", st, body)
	}
	if st, _ := req(t, app, "POST", "/api/money/collections", "bob", newCollection); st != 201 {
		t.Fatalf("bob's own collection: %d", st)
	}
	for _, bad := range []string{
		`{"owner_name":"E","kind":"party","title":"x","currency":"USD"}`,
		`{"owner_name":"E","kind":"wedding","title":"","currency":"USD"}`,
		`{"owner_name":"E","kind":"wedding","title":"x","currency":"CDF"}`,
		`{"owner_name":"E","kind":"wedding","title":"x","currency":"USD","deadline":"2000-01-01"}`,
		`{"owner_name":"E","kind":"wedding","title":"x","currency":"USD","owner_id":"alice"}`,
	} {
		if st, _ := req(t, app, "POST", "/api/money/collections", "carol", bad); st != 400 {
			t.Errorf("invalid collection accepted (%d): %s", st, bad)
		}
	}
}

func TestCollectionDrafts(t *testing.T) {
	app, _, _ := moneyApp(t, 0, 0)
	_, col := req(t, app, "POST", "/api/money/collections", "alice", newCollection)
	id, token := col["id"].(string), col["share_token"].(string)
	req(t, app, "POST", "/api/public/collections/"+token+"/pledge", "", `{"name":"Patrick","amount":"100"}`)
	_, col = req(t, app, "POST", "/api/public/collections/"+token+"/pledge", "", `{"name":"Marie","amount":"50","sent":true}`)
	_, col = req(t, app, "GET", "/api/money/collections/"+id, "alice", "")
	ids := map[string]string{}
	for _, c := range col["contributions"].([]any) {
		m := c.(map[string]any)
		ids[m["name"].(string)] = m["id"].(string)
	}

	st, r := req(t, app, "POST", "/api/money/collections/"+id+"/draft", "alice", `{"purpose":"reminder","language":"fr","contribution_id":"`+ids["Patrick"]+`"}`)
	if st != 200 || r["message"] != "[fr] Patrick promised 100.00 USD" {
		t.Fatalf("reminder: %d %+v", st, r)
	}
	// Someone who already sent doesn't get a reminder.
	if st, _ := req(t, app, "POST", "/api/money/collections/"+id+"/draft", "alice", `{"purpose":"reminder","language":"fr","contribution_id":"`+ids["Marie"]+`"}`); st != 409 {
		t.Fatalf("reminder to sender: %d", st)
	}
	st, r = req(t, app, "POST", "/api/money/collections/"+id+"/draft", "alice", `{"purpose":"update","language":"en"}`)
	if st != 200 || r["message"] != "[en] 0.00 USD received of 150.00 USD from 2" {
		t.Fatalf("update: %d %+v", st, r)
	}
	if st, _ := req(t, app, "POST", "/api/money/collections/"+id+"/draft", "alice", `{"purpose":"update","language":"ln"}`); st != 400 {
		t.Fatalf("lingala: %d", st)
	}
	_, col = req(t, app, "POST", "/api/money/collections/"+id+"/contributions/"+ids["Patrick"]+"/reminded", "alice", "")
	for _, c := range col["contributions"].([]any) {
		if m := c.(map[string]any); m["name"] == "Patrick" && m["reminders_count"].(float64) != 1 {
			t.Fatalf("reminded count: %+v", m)
		}
	}
}
