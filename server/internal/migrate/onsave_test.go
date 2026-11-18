package migrate_test

import (
	"context"
	"testing"

	"mayelai/server/internal/migrate"
	"mayelai/server/internal/testdb"
)

// Migration 5 links each organizer to their own "I'm a member too" membership
// in groups created before onSave, and nothing else.
func TestOnSaveBackfill(t *testing.T) {
	pool, url := testdb.New(t)
	ctx := context.Background()
	if err := migrate.DownTo(ctx, url, 4); err != nil {
		t.Fatal(err)
	}
	pool.Reset() // the schema changed under the pool's cached statements
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO money_groups (id, owner_id, owner_name, name, currency, amount_cents, frequency, share_token)
		VALUES ('00000000-0000-0000-0000-000000000001', 'alice', 'Alice', 'G', 'USD', 100, 'monthly', 'tok1')`)
	exec(`INSERT INTO money_group_members (group_id, name, position, member_token, source) VALUES
		('00000000-0000-0000-0000-000000000001', 'Alice', 1, 'm1', 'organizer'),
		('00000000-0000-0000-0000-000000000001', 'Alice', 2, 'm2', 'organizer'),
		('00000000-0000-0000-0000-000000000001', 'Bob', 3, 'm3', 'link')`)
	if _, err := migrate.Up(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool.Reset()
	rows, err := pool.Query(ctx, `SELECT member_token FROM money_group_members WHERE user_id = 'alice'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		got = append(got, s)
	}
	if len(got) != 1 || got[0] != "m1" {
		t.Fatalf("linked members = %v, want [m1]", got)
	}
}
