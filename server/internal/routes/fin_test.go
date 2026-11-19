package routes

import (
	"testing"

	"github.com/gofiber/fiber/v3"

	"mayelai/server/internal/auth"
)

// Without Plaid keys AI Fin says so instead of failing.
func TestFinDisabled(t *testing.T) {
	app := fiber.New()
	app.Use(func(c fiber.Ctx) error {
		if u := c.Get("X-Test-User"); u != "" {
			auth.SetUserID(c, u)
		}
		return c.Next()
	})
	registerFin(app.Group("/api", auth.Require()), Deps{})
	if st, out := req(t, app, "GET", "/api/fin", "alice", ""); st != 200 || out["enabled"] != false {
		t.Fatalf("overview: %d %+v", st, out)
	}
	if st, _ := req(t, app, "POST", "/api/fin/link-token", "alice", `{}`); st != 503 {
		t.Fatalf("link token: %d", st)
	}
	if st, _ := req(t, app, "GET", "/api/fin", "", ""); st != 401 {
		t.Fatalf("signed out: %d", st)
	}
}
