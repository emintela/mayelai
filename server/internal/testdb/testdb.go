// Package testdb creates a fresh, fully migrated Postgres database per test
// run. Set TEST_DATABASE_URL to a server where the user may CREATE DATABASE
// (e.g. postgres://postgres@localhost:5432/postgres?sslmode=disable for a local
// Postgres); tests are skipped when it is unset. NEVER point it at
// production: databases named mayelai_test_* are created and dropped.
package testdb

import (
	"context"
	"fmt"
	"math/rand/v2"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mayelai/server/internal/migrate"
)

// New returns a pool and URL for a new migrated database, dropped at cleanup.
func New(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	admin := os.Getenv("TEST_DATABASE_URL")
	if admin == "" {
		t.Skip("set TEST_DATABASE_URL to run database tests")
	}
	if err := checkLocal(admin); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	name := fmt.Sprintf("mayelai_test_%d_%d", time.Now().Unix(), rand.IntN(1_000_000))
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatalf("create database: %v", err)
	}
	conn.Close(ctx)

	u, err := url.Parse(admin)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	dbURL := u.String()
	if _, err := migrate.Up(ctx, dbURL); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if conn, err := pgx.Connect(ctx, admin); err == nil {
			_, _ = conn.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
			conn.Close(ctx)
		}
	})
	return pool, dbURL
}

// checkLocal refuses non-local servers: tests create and drop databases, so a
// mistyped TEST_DATABASE_URL must never reach a hosted (e.g. Neon) server.
// Set FAITHAI_ALLOW_REMOTE_TEST_DB=1 for a dedicated remote test server.
func checkLocal(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1", "postgres":
		return nil
	}
	if os.Getenv("FAITHAI_ALLOW_REMOTE_TEST_DB") == "1" {
		return nil
	}
	return fmt.Errorf("TEST_DATABASE_URL points at %q: tests create and drop databases, so only local servers are allowed (set FAITHAI_ALLOW_REMOTE_TEST_DB=1 for a dedicated test server)", u.Hostname())
}
