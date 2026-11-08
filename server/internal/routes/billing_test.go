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
	"github.com/stripe/stripe-go/v87/webhook"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/billing"
	"mayelai/server/internal/chat"
	"mayelai/server/internal/config"
	"mayelai/server/internal/db"
	"mayelai/server/internal/openai"
	"mayelai/server/internal/routes"
)

// TestBillingWebhook sends signed fake Stripe events to the webhook and checks
// the user's plan and limits. It uses the real database (no Stripe account or
// OpenAI calls):
//
//	MAYELAI_SMOKE=1 go test ./internal/routes -run TestBillingWebhook -v
func TestBillingWebhook(t *testing.T) {
	if os.Getenv("MAYELAI_SMOKE") != "1" {
		t.Skip("set MAYELAI_SMOKE=1 to run (uses DATABASE_URL)")
	}
	_ = godotenv.Load("../../.env")
	const user, customer, secret = "user_billingtest_go", "cus_billingtest", "whsec_test_secret"

	cfg := config.Load()
	cfg.StripeSecretKey, cfg.StripeWebhookSecret, cfg.StripeProPriceID = "sk_test_fake", secret, "price_fake"
	ctx := context.Background()
	store, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cleanup := func() {
		conn, _ := pgx.Connect(ctx, cfg.DatabaseURL)
		defer conn.Close(ctx)
		conn.Exec(ctx, `DELETE FROM subscriptions WHERE user_id = $1 OR provider_customer_id = 'cus_unknown'`, user)
	}
	cleanup()
	defer cleanup()

	app := fiber.New()
	app.Use(func(c fiber.Ctx) error { auth.SetUserID(c, user); return c.Next() })
	routes.Register(app, routes.Deps{
		Chat: chat.New(cfg, store, openai.New("")), Store: store,
		Billing: billing.New(cfg, store), Config: cfg, PerMinute: 100,
	})

	sendEvent := func(typ, status, cust string, created time.Time, withMeta bool, sig string) int {
		meta := `{}`
		if withMeta {
			meta = fmt.Sprintf(`{"user_id":%q}`, user)
		}
		end := time.Now().Add(30 * 24 * time.Hour).Unix()
		payload := fmt.Sprintf(`{"id":"evt_%d","object":"event","api_version":"2099-01-01","type":%q,"created":%d,
			"data":{"object":{"id":"sub_test","object":"subscription","customer":%q,"status":%q,
			"cancel_at_period_end":false,"metadata":%s,
			"items":{"data":[{"current_period_end":%d}]}}}}`,
			created.UnixNano(), typ, created.Unix(), cust, status, meta, end)
		signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: []byte(payload), Secret: secret})
		header := signed.Header
		if sig != "" {
			header = sig
		}
		req := httptest.NewRequest("POST", "/webhooks/stripe", strings.NewReader(payload))
		req.Header.Set("Stripe-Signature", header)
		resp, err := app.Test(req, fiber.TestConfig{Timeout: 30 * time.Second})
		if err != nil {
			t.Fatal(err)
		}
		return resp.StatusCode
	}
	billingState := func() (plan string, limit float64) {
		resp, err := app.Test(httptest.NewRequest("GET", "/api/billing", nil), fiber.TestConfig{Timeout: 30 * time.Second})
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(resp.Body)
		var out map[string]any
		json.Unmarshal(raw, &out)
		t.Logf("GET /api/billing -> %s", raw)
		q := out["quota"].(map[string]any)
		return q["plan"].(string), q["limit"].(float64)
	}

	if plan, limit := billingState(); plan != "free" || limit != float64(cfg.Free.Messages) {
		t.Fatalf("start: %s %v", plan, limit)
	}
	store.SetCustomerID(ctx, user, "stripe", customer)

	now := time.Now()
	if code := sendEvent("customer.subscription.created", "active", customer, now, true, ""); code != 200 {
		t.Fatalf("created: %d", code)
	}
	if plan, limit := billingState(); plan != "pro" || limit != float64(cfg.Pro.Messages) {
		t.Errorf("after subscribe: %s %v", plan, limit)
	}

	// An older event arriving late must not override newer state.
	if code := sendEvent("customer.subscription.updated", "canceled", customer, now.Add(-time.Hour), true, ""); code != 200 {
		t.Fatalf("stale: %d", code)
	}
	if plan, _ := billingState(); plan != "pro" {
		t.Errorf("stale event changed plan to %s", plan)
	}

	// Payment failing -> past_due keeps Pro while Stripe retries.
	sendEvent("customer.subscription.updated", "past_due", customer, now.Add(time.Minute), false, "")
	if plan, _ := billingState(); plan != "pro" {
		t.Errorf("past_due: %s", plan)
	}

	// Cancelled (found by customer ID, no metadata).
	if code := sendEvent("customer.subscription.deleted", "canceled", customer, now.Add(2*time.Minute), false, ""); code != 200 {
		t.Fatalf("deleted: %d", code)
	}
	if plan, limit := billingState(); plan != "free" || limit != float64(cfg.Free.Messages) {
		t.Errorf("after cancel: %s %v", plan, limit)
	}

	if code := sendEvent("customer.subscription.created", "active", customer, now, true, "t=1,v1=bad"); code != 400 {
		t.Errorf("bad signature: %d", code)
	}
	if code := sendEvent("customer.subscription.created", "active", "cus_unknown", now, false, ""); code != 200 {
		t.Errorf("unknown customer: %d", code)
	}
	if code := sendEvent("invoice.paid", "", customer, now, false, ""); code != 200 {
		t.Errorf("ignored event: %d", code)
	}
}
