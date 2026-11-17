package routes

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

const newGroup = `{"owner_name":"Eddy","name":"Likelemba ya ba Ndeko","rules":"Zelle: eddy@example.com","currency":"USD","amount":"100","frequency":"monthly","include_me":true}`

// memberReq calls a public group endpoint with an optional personal member token.
func memberReq(t *testing.T, app *fiber.App, method, path, memberToken, body string) (int, map[string]any) {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	rq := httptest.NewRequest(method, path, r)
	rq.Header.Set("Content-Type", "application/json")
	if memberToken != "" {
		rq.Header.Set("X-Member-Token", memberToken)
	}
	resp, err := app.Test(rq, fiber.TestConfig{Timeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out := map[string]any{}
	raw, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

func members(g map[string]any) []map[string]any {
	var out []map[string]any
	for _, m := range g["members"].([]any) {
		out = append(out, m.(map[string]any))
	}
	return out
}

func TestGroupLifecycle(t *testing.T) {
	app, _, _ := moneyApp(t, 0, 0)
	st, g := req(t, app, "POST", "/api/money/groups", "alice", newGroup)
	if st != 201 || g["status"] != "forming" || g["member_count"].(float64) != 1 {
		t.Fatalf("create: %d %+v", st, g)
	}
	id, token := g["id"].(string), g["share_token"].(string)
	base := "/api/money/groups/" + id

	if st, _ := req(t, app, "POST", base+"/start", "alice", `{"start_date":"`+time.Now().Format("2006-01-02")+`"}`); st != 400 {
		t.Fatalf("start with 1 member: %d", st)
	}
	req(t, app, "POST", base+"/members", "alice", `{"name":"Patrick","phone":"+243 81 234 5678"}`)
	// Marie joins through the public link and gets a personal token.
	st, j := memberReq(t, app, "POST", "/api/public/groups/"+token+"/join", "", `{"name":"Marie"}`)
	if st != 201 || len(j["member_token"].(string)) != 32 {
		t.Fatalf("join: %d %+v", st, j)
	}
	marieToken := j["member_token"].(string)
	if you := j["group"].(map[string]any)["you"]; you == nil || you.(map[string]any)["name"] != "Marie" {
		t.Fatalf("join 'you': %+v", j["group"])
	}

	// Order: invalid (missing a member), then a random draw.
	_, g = req(t, app, "GET", base, "alice", "")
	ms := members(g)
	if st, _ := req(t, app, "POST", base+"/order", "alice", fmt.Sprintf(`{"member_ids":["%s","%s"]}`, ms[0]["id"], ms[1]["id"])); st != 400 {
		t.Fatalf("partial order: %d", st)
	}
	order := fmt.Sprintf(`{"member_ids":["%s","%s","%s"]}`, ms[2]["id"], ms[0]["id"], ms[1]["id"])
	if st, g = req(t, app, "POST", base+"/order", "alice", order); st != 200 || members(g)[0]["name"] != "Marie" {
		t.Fatalf("order: %d %+v", st, members(g))
	}
	if st, g = req(t, app, "POST", base+"/draw", "alice", ""); st != 200 || len(members(g)) != 3 {
		t.Fatalf("draw: %d", st)
	}
	positions := map[float64]bool{}
	for _, m := range members(g) {
		positions[m["position"].(float64)] = true
	}
	if len(positions) != 3 || !positions[1] || !positions[2] || !positions[3] {
		t.Fatalf("draw positions: %+v", members(g))
	}

	// Start: calendar of 3 monthly rounds; pot = 300.
	st, g = req(t, app, "POST", base+"/start", "alice", `{"start_date":"2026-12-15","today":"2026-11-17"}`)
	if st != 200 || g["status"] != "active" || len(g["rounds"].([]any)) != 3 || g["pot_cents"].(float64) != 30000 || g["current_round"].(float64) != 1 {
		t.Fatalf("start: %d %+v", st, g)
	}
	if d := g["rounds"].([]any)[2].(map[string]any)["date"]; d != "2027-02-15" {
		t.Fatalf("round 3 date: %v", d)
	}
	// Forming-only changes are refused now.
	for _, c := range []struct{ path, body string }{
		{base + "/members", `{"name":"Late"}`},
		{base + "/draw", ""},
	} {
		if st, _ := req(t, app, "POST", c.path, "alice", c.body); st != 400 {
			t.Errorf("%s after start: %d", c.path, st)
		}
	}
	if st, _ := req(t, app, "PATCH", base, "alice", `{"amount":"200"}`); st != 400 {
		t.Fatalf("amount change after start: %d", st)
	}
	if st, _ := memberReq(t, app, "POST", "/api/public/groups/"+token+"/join", "", `{"name":"Late"}`); st != 409 {
		t.Fatalf("join after start: %d", st)
	}

	// Marie says she paid round 1 (only for herself; needs her token).
	st, pg := memberReq(t, app, "POST", "/api/public/groups/"+token+"/paid", marieToken, `{"round":1,"method":"Zelle"}`)
	if st != 200 || pg["rounds"].([]any)[0].(map[string]any)["sent_count"].(float64) != 1 {
		t.Fatalf("member paid: %d %+v", st, pg)
	}
	if st, _ := memberReq(t, app, "POST", "/api/public/groups/"+token+"/paid", "", `{"round":1}`); st != 404 {
		t.Fatalf("paid without token: %d", st)
	}
	if st, _ := memberReq(t, app, "POST", "/api/public/groups/"+token+"/paid", strings.Repeat("x", 32), `{"round":1}`); st != 404 {
		t.Fatalf("paid with bad token: %d", st)
	}
	if st, _ := memberReq(t, app, "POST", "/api/public/groups/"+token+"/paid", marieToken, `{"round":9}`); st != 400 {
		t.Fatalf("paid bad round: %d", st)
	}

	// Public view: no phones or personal links; "you" only with your own token.
	_, pub := memberReq(t, app, "GET", "/api/public/groups/"+token, "", "")
	raw, _ := json.Marshal(pub)
	if strings.Contains(string(raw), "+243") || strings.Contains(string(raw), marieToken) || strings.Contains(string(raw), "share_token") || pub["you"] != nil {
		t.Fatalf("public view leaks: %s", raw)
	}

	// Organizer confirms everyone, pays out all rounds -> completed; undo -> active.
	_, g = req(t, app, "GET", base, "alice", "")
	for r := 1; r <= 3; r++ {
		for _, m := range members(g) {
			req(t, app, "POST", base+"/payments", "alice", fmt.Sprintf(`{"member_id":"%s","round":%d,"status":"received","method":"Zelle"}`, m["id"], r))
		}
		st, g = req(t, app, "POST", base+"/payouts", "alice", fmt.Sprintf(`{"round":%d,"paid":true}`, r))
		if st != 200 {
			t.Fatalf("payout %d: %d", r, st)
		}
	}
	if g["status"] != "completed" || g["rounds"].([]any)[0].(map[string]any)["received_count"].(float64) != 3 {
		t.Fatalf("completed: %+v", g["status"])
	}
	if _, g = req(t, app, "POST", base+"/payouts", "alice", `{"round":3,"paid":false}`); g["status"] != "active" || g["current_round"].(float64) != 3 {
		t.Fatalf("undo payout: %+v %v", g["status"], g["current_round"])
	}
	// A member's "I paid" never downgrades a confirmed payment.
	memberReq(t, app, "POST", "/api/public/groups/"+token+"/paid", marieToken, `{"round":1}`)
	_, g = req(t, app, "GET", base, "alice", "")
	if g["rounds"].([]any)[0].(map[string]any)["received_count"].(float64) != 3 {
		t.Fatal("member's 'paid' downgraded a received payment")
	}
}

func TestGroupIsolationLimitAndDrafts(t *testing.T) {
	app, _, _ := moneyApp(t, 1, 0)
	_, g := req(t, app, "POST", "/api/money/groups", "alice", newGroup)
	id := g["id"].(string)
	base := "/api/money/groups/" + id
	_, g = req(t, app, "POST", base+"/members", "alice", `{"name":"Patrick"}`)
	ms := members(g)

	for _, c := range []struct{ method, path, body string }{
		{"GET", base, ""},
		{"PATCH", base, `{"name":"hacked"}`},
		{"POST", base + "/members", `{"name":"X"}`},
		{"DELETE", base + "/members/" + ms[1]["id"].(string), ""},
		{"POST", base + "/draw", ""},
		{"POST", base + "/start", `{"start_date":"2026-12-01"}`},
		{"POST", base + "/cancel", ""},
		{"POST", base + "/link", ""},
		{"DELETE", base, ""},
	} {
		if st, _ := req(t, app, c.method, c.path, "bob", c.body); st != 404 {
			t.Errorf("bob %s %s: %d, want 404", c.method, c.path, st)
		}
	}
	if st, body := req(t, app, "POST", "/api/money/groups", "alice", newGroup); st != 403 || body["code"] != "limit_groups" {
		t.Fatalf("limit: %d %+v", st, body)
	}

	// Drafts need a running group.
	if st, _ := req(t, app, "POST", base+"/draft", "alice", `{"purpose":"update","language":"fr"}`); st != 409 {
		t.Fatalf("draft while forming: %d", st)
	}
	req(t, app, "POST", base+"/start", "alice", `{"start_date":"2026-12-01","today":"2026-11-17"}`)
	_, g = req(t, app, "GET", base, "alice", "")
	r1 := g["rounds"].([]any)[0].(map[string]any)
	payer, other := members(g)[0]["id"].(string), members(g)[1]["id"].(string)
	req(t, app, "POST", base+"/payments", "alice", `{"member_id":"`+payer+`","round":1,"status":"received"}`)
	if st, _ := req(t, app, "POST", base+"/draft", "alice", `{"purpose":"reminder","language":"fr","member_id":"`+payer+`"}`); st != 409 {
		t.Fatalf("reminder to payer: %d", st)
	}
	st, r := req(t, app, "POST", base+"/draft", "alice", `{"purpose":"reminder","language":"en","member_id":"`+other+`"}`)
	if st != 200 || !strings.Contains(r["message"].(string), "pay 100.00 USD round 1") {
		t.Fatalf("reminder: %d %+v", st, r)
	}
	st, r = req(t, app, "POST", base+"/draft", "alice", `{"purpose":"update","language":"fr"}`)
	if st != 200 || r["message"] != fmt.Sprintf("[fr] round 1: 1/2 paid, pot to %s", r1["recipient_name"]) {
		t.Fatalf("update: %d %+v", st, r)
	}
	// Cancelled groups free the slot.
	req(t, app, "POST", base+"/cancel", "alice", "")
	if st, _ := req(t, app, "POST", "/api/money/groups", "alice", newGroup); st != 201 {
		t.Fatalf("create after cancel: %d", st)
	}
}
