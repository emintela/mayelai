package routes

import (
	"fmt"
	"testing"
	"time"
)

func TestOnSaveMembersAndActivity(t *testing.T) {
	app, _, _ := moneyApp(t, 0, 0)
	_, g := req(t, app, "POST", "/api/money/groups", "alice", newGroup)
	id, token := g["id"].(string), g["share_token"].(string)
	mine := "/api/onsave/groups/" + id

	// The organizer's own membership is linked to their account.
	st, list := req(t, app, "GET", "/api/onsave/groups", "alice", "")
	gs := list["groups"].([]any)
	if st != 200 || len(gs) != 1 {
		t.Fatalf("alice groups: %d %+v", st, list)
	}
	ag := gs[0].(map[string]any)
	if ag["role"] != "organizer" || ag["you"] == nil || ag["share_token"] != token {
		t.Fatalf("organizer view: %+v", ag)
	}

	// Bob joins with his account; joining twice doesn't add him twice.
	req(t, app, "POST", "/api/money/groups/"+id+"/members", "alice", `{"name":"Patrick","phone":"+243 81 234 5678"}`)
	st, bg := req(t, app, "POST", "/api/onsave/join/"+token, "bob", `{"name":"Bob","phone":""}`)
	if st != 200 || bg["role"] != "member" || bg["you"].(map[string]any)["name"] != "Bob" {
		t.Fatalf("bob join: %d %+v", st, bg)
	}
	if bg["share_token"] != nil && bg["share_token"] != "" {
		t.Fatalf("member sees share token: %+v", bg["share_token"])
	}
	for _, m := range members(bg) {
		if m["phone"] != nil || m["member_token"] != nil {
			t.Fatalf("member sees private fields: %+v", m)
		}
	}
	if _, again := req(t, app, "POST", "/api/onsave/join/"+token, "bob", `{"name":"Bob","phone":""}`); again["member_count"].(float64) != 3 {
		t.Fatalf("double join: %+v", again["member_count"])
	}

	// Carol joins without an account, then signs up and claims her personal link.
	_, j := memberReq(t, app, "POST", "/api/public/groups/"+token+"/join", "", `{"name":"Carol"}`)
	carolToken := j["member_token"].(string)
	claim := fmt.Sprintf(`{"token":%q,"member_token":%q}`, token, carolToken)
	if st, r := req(t, app, "POST", "/api/onsave/claim", "carol", claim); st != 200 || r["group_id"] != id {
		t.Fatalf("claim: %d %+v", st, r)
	}
	if st, _ := req(t, app, "POST", "/api/onsave/claim", "carol", claim); st != 200 {
		t.Fatalf("claim again: %d", st)
	}
	if st, _ := req(t, app, "POST", "/api/onsave/claim", "dave", claim); st != 409 {
		t.Fatalf("claim by someone else: %d", st)
	}
	if st, _ := req(t, app, "POST", "/api/onsave/claim", "dave", fmt.Sprintf(`{"token":%q,"member_token":"%s"}`, token, "x")); st != 404 {
		t.Fatalf("bad claim: %d", st)
	}

	// Outsiders see nothing.
	if st, _ := req(t, app, "GET", mine, "eve", ""); st != 404 {
		t.Fatalf("outsider get: %d", st)
	}
	if st, _ := req(t, app, "POST", mine+"/paid", "bob", `{"round":1,"method":"Zelle"}`); st != 409 {
		t.Fatalf("pay while forming: %d", st)
	}

	// Run a round: Bob says he paid, Alice confirms and hands over the pot.
	req(t, app, "POST", "/api/money/groups/"+id+"/start", "alice", `{"start_date":"`+time.Now().Format("2006-01-02")+`"}`)
	st, bg = req(t, app, "POST", mine+"/paid", "bob", `{"round":1,"method":"Zelle"}`)
	if st != 200 {
		t.Fatalf("bob paid: %d %+v", st, bg)
	}
	bobID := bg["you"].(map[string]any)["id"].(string)
	pays := bg["rounds"].([]any)[0].(map[string]any)["payments"].([]any)
	if len(pays) != 1 || pays[0].(map[string]any)["status"] != "sent" {
		t.Fatalf("bob payment: %+v", pays)
	}
	if st, _ := req(t, app, "POST", mine+"/paid", "eve", `{"round":1,"method":""}`); st != 404 {
		t.Fatalf("outsider pays: %d", st)
	}
	req(t, app, "POST", "/api/money/groups/"+id+"/payments", "alice", fmt.Sprintf(`{"member_id":%q,"round":1,"status":"received","method":""}`, bobID))
	req(t, app, "POST", "/api/money/groups/"+id+"/payouts", "alice", `{"round":1,"paid":true}`)
	// Bob marking "I paid" again must not undo the confirmation.
	_, bg = req(t, app, "POST", mine+"/paid", "bob", `{"round":1,"method":""}`)
	if bg["rounds"].([]any)[0].(map[string]any)["payments"].([]any)[0].(map[string]any)["status"] != "received" {
		t.Fatalf("confirmation downgraded")
	}

	_, act := req(t, app, "GET", "/api/onsave/activity", "bob", "")
	kinds := map[string]bool{}
	for _, e := range act["events"].([]any) {
		ev := e.(map[string]any)
		kinds[ev["kind"].(string)] = true
		if ev["kind"] == "sent" && (ev["who"] != "Bob" || ev["you"] != true || ev["method"] != "Zelle") {
			t.Fatalf("sent event: %+v", ev)
		}
		if ev["kind"] == "payout" && ev["amount_cents"].(float64) != 40000 {
			t.Fatalf("payout pot: %+v", ev)
		}
	}
	for _, k := range []string{"joined", "sent", "received", "payout"} {
		if !kinds[k] {
			t.Fatalf("missing %s in %+v", k, act)
		}
	}
	if _, act := req(t, app, "GET", "/api/onsave/activity", "eve", ""); len(act["events"].([]any)) != 0 {
		t.Fatalf("outsider activity: %+v", act)
	}
	if _, l := req(t, app, "GET", "/api/onsave/groups", "carol", ""); len(l["groups"].([]any)) != 1 {
		t.Fatalf("carol groups: %+v", l)
	}
}
