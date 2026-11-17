package main

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"
)

func TestCanonicalHost(t *testing.T) {
	app := fiber.New()
	app.Use(canonicalHost("mayelai.com", []string{"www.mayelai.com", "mayelai.app", "www.mayelai.org"}))
	app.All("/*", func(c fiber.Ctx) error { return c.SendString("ok") })

	cases := []struct {
		method, host, path string
		status             int
		location           string
	}{
		{"GET", "www.mayelai.com", "/l/abc?x=1", 301, "https://mayelai.com/l/abc?x=1"},
		{"GET", "MAYELAI.APP", "/", 301, "https://mayelai.com/"},
		{"POST", "www.mayelai.org", "/api/money/loans", 308, "https://mayelai.com/api/money/loans"},
		{"GET", "mayelai.com", "/money", 200, ""},
		{"GET", "mayelai.fly.dev", "/money", 200, ""},
		{"GET", "localhost:3001", "/", 200, ""},
		{"GET", "evil.example", "/", 200, ""},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, "http://"+tc.host+tc.path, nil)
		req.Host = tc.host
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != tc.status || resp.Header.Get("Location") != tc.location {
			t.Errorf("%s %s%s: %d %q, want %d %q", tc.method, tc.host, tc.path, resp.StatusCode, resp.Header.Get("Location"), tc.status, tc.location)
		}
	}
	// Disabled when no canonical host is configured.
	off := fiber.New()
	off.Use(canonicalHost("", []string{"www.mayelai.com"}))
	off.Get("/", func(c fiber.Ctx) error { return c.SendString("ok") })
	req := httptest.NewRequest("GET", "http://www.mayelai.com/", nil)
	if resp, _ := off.Test(req); resp.StatusCode != 200 {
		t.Fatalf("redirect active without CANONICAL_HOST: %d", resp.StatusCode)
	}
}
