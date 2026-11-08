package routes_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/chat"
	"mayelai/server/internal/config"
	"mayelai/server/internal/db"
	"mayelai/server/internal/openai"
	"mayelai/server/internal/routes"
)

const testUser = "user_smoketest_go"

// TestSmoke exercises the whole chat flow against the real database and
// OpenAI using a fake user (data is deleted afterwards). It costs a few
// cents, so it only runs when asked:
//
//	MAYELAI_SMOKE=1 go test ./internal/routes -run TestSmoke -v
func TestSmoke(t *testing.T) {
	if os.Getenv("MAYELAI_SMOKE") != "1" {
		t.Skip("set MAYELAI_SMOKE=1 to run (calls OpenAI, uses DATABASE_URL)")
	}
	_ = godotenv.Load("../../.env")
	cfg := config.Load()
	cfg.HistoryMessages, cfg.SummaryBatch = 2, 2 // force summarization quickly
	cfg.Free.Messages = 8
	ctx := context.Background()

	store, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cleanup := func() {
		conn, err := pgx.Connect(ctx, cfg.DatabaseURL)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close(ctx)
		conn.Exec(ctx, `DELETE FROM conversations WHERE user_id=$1`, testUser)
		conn.Exec(ctx, `DELETE FROM usage_daily WHERE user_id=$1`, testUser)
		conn.Exec(ctx, `DELETE FROM response_cache`)
	}
	cleanup()
	defer cleanup()

	svc := chat.New(cfg, store, openai.New(cfg.OpenAIKey))
	app := fiber.New()
	app.Use(func(c fiber.Ctx) error { auth.SetUserID(c, testUser); return c.Next() })
	routes.Register(app, routes.Deps{Chat: svc, Store: store, Config: cfg, PerMinute: 100})

	do := func(method, path, body string) (int, map[string]any) {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req, fiber.TestConfig{Timeout: 2 * time.Minute})
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(resp.Body)
		var out map[string]any
		_ = json.Unmarshal(raw, &out)
		t.Logf("%s %s -> %d %s", method, path, resp.StatusCode, trunc(string(raw), 260))
		return resp.StatusCode, out
	}
	send := func(conv, msg, mode string) (int, map[string]any) {
		b, _ := json.Marshal(map[string]string{"conversationId": conv, "message": msg, "mode": mode})
		return do("POST", "/api/chat", string(b))
	}

	// 1. New conversation
	code, r := send("", "My name is Amani and I live in Kinshasa. What is the main river there?", "")
	if code != 200 {
		t.Fatalf("send: %d", code)
	}
	convID := r["conversation"].(map[string]any)["id"].(string)

	// 2. Follow-ups (exercise history + summarization)
	for _, q := range []string{"Name one fish found in it.", "How long is it, roughly?", "Translate 'thank you' to Lingala."} {
		if code, _ := send(convID, q, ""); code != 200 {
			t.Fatalf("follow-up %d", code)
		}
	}
	svc.Wait()
	{
		conn, _ := pgx.Connect(ctx, cfg.DatabaseURL)
		var s string
		var n int
		conn.QueryRow(ctx, `SELECT summary, summary_count FROM conversations WHERE id=$1`, convID).Scan(&s, &n)
		t.Logf("SUMMARY BEFORE MEMORY Q (covers %d): %s", n, s)
		conn.Close(ctx)
	}
	code, r = send(convID, "What is my name and city? Answer in 5 words.", "")
	if code != 200 {
		t.Fatalf("memory check %d", code)
	}
	t.Logf("MEMORY ANSWER: %v", r["assistantMessage"].(map[string]any)["content"])
	svc.Wait()

	conn, _ := pgx.Connect(ctx, cfg.DatabaseURL)
	var summary string
	var count int
	conn.QueryRow(ctx, `SELECT summary, summary_count FROM conversations WHERE id=$1`, convID).Scan(&summary, &count)
	t.Logf("SUMMARY (covers %d msgs): %s", count, summary)
	conn.Close(ctx)
	if summary == "" {
		t.Error("expected a rolling summary")
	}

	// 3. Response cache: same first question twice in new chats
	send("", "What is the capital of Senegal?", "")
	_, r = send("", "  what is the capital of senegal ", "")
	meta := r["assistantMessage"].(map[string]any)["metadata"].(map[string]any)
	t.Logf("CACHED: %v", meta["cached"])
	if meta["cached"] != true {
		t.Error("expected cache hit")
	}

	// 3b. Feedback on an assistant message
	asstID := int64(r["assistantMessage"].(map[string]any)["id"].(float64))
	if code, _ := do("PUT", fmt.Sprintf("/api/messages/%d/feedback", asstID), `{"value":1}`); code != 200 {
		t.Errorf("feedback: %d", code)
	}
	if code, _ := do("PUT", fmt.Sprintf("/api/messages/%d/feedback", asstID), `{"value":5}`); code != 400 {
		t.Errorf("bad feedback: %d", code)
	}
	if code, _ := do("PUT", "/api/messages/999999999/feedback", `{"value":1}`); code != 404 {
		t.Errorf("missing msg feedback: %d", code)
	}
	if code, _ := send("not-a-uuid", "hi there", ""); code != 404 {
		t.Errorf("bad conv id: %d", code)
	}

	// 4. AI search mode
	code, r = send(convID, "What is today's top news headline in DR Congo?", "search")
	if code != 200 {
		t.Errorf("search: %d", code)
	}

	// 5. Daily limit (limit 8; used 8 so far)
	if code, _ := send(convID, "one more", ""); code != 429 {
		t.Errorf("expected 429, got %d", code)
	}
	do("GET", "/api/usage", "")

	// 6. History list, search, get, delete
	_, r = do("GET", "/api/conversations", "")
	if n := len(r["conversations"].([]any)); n != 3 {
		t.Errorf("expected 3 conversations, got %d", n)
	}
	_, r = do("GET", "/api/conversations?q=lingala", "")
	if n := len(r["conversations"].([]any)); n != 1 {
		t.Errorf("search: expected 1, got %d", n)
	}
	_, r = do("GET", "/api/conversations?q=100%25_", "")
	if n := len(r["conversations"].([]any)); n != 0 {
		t.Errorf("wildcard search: expected 0, got %d", n)
	}
	_, r = do("GET", "/api/conversations/"+convID, "")
	t.Logf("MESSAGES in conv: %d", len(r["messages"].([]any)))
	if code, _ := do("GET", "/api/conversations/not-a-uuid", ""); code != 404 {
		t.Errorf("bad uuid: %d", code)
	}
	if code, _ := do("GET", "/api/conversations/00000000-0000-0000-0000-000000000000", ""); code != 404 {
		t.Errorf("missing: %d", code)
	}
	if code, _ := do("DELETE", "/api/conversations/"+convID, ""); code != 204 {
		t.Errorf("delete: %d", code)
	}
	do("DELETE", "/api/conversations", "")
	_, r = do("GET", "/api/conversations", "")
	if n := len(r["conversations"].([]any)); n != 0 {
		t.Errorf("after delete all: %d", n)
	}

	// 7. Unauthenticated app
	app2 := fiber.New()
	routes.Register(app2, routes.Deps{Chat: svc, Store: store, Config: cfg, PerMinute: 100})
	resp, _ := app2.Test(httptest.NewRequest("GET", "/api/conversations", nil))
	if resp.StatusCode != 401 {
		t.Errorf("unauth: %d", resp.StatusCode)
	}
}

func trunc(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
