package routes

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestPushDevices(t *testing.T) {
	app, _, store, pushes := moneyAppWithPush(t, 0, 0)
	iphone := "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
	android := "fcm-token_abc:APA91bExampleExampleExample"

	if st, k := req(t, app, "GET", "/api/push/key", "alice", ""); st != 200 || k["native"].(map[string]any)["ios"] != true {
		t.Fatalf("key: %d %+v", st, k)
	}
	for _, c := range []struct{ platform, token string }{{"ios", iphone}, {"android", android}, {"android", "dead-token-uninstalled-app"}} {
		if st, out := req(t, app, "POST", "/api/push/device", "alice", `{"platform":"`+c.platform+`","token":"`+c.token+`","lang":"fr"}`); st != 200 || out["enabled"] != true {
			t.Fatalf("register %s: %d %+v", c.platform, st, out)
		}
	}
	for _, bad := range []string{
		`{"platform":"windows","token":"` + iphone + `"}`,
		`{"platform":"ios","token":"short"}`,
		`{"platform":"ios","token":"has spaces in it which is not a token"}`,
	} {
		if st, _ := req(t, app, "POST", "/api/push/device", "alice", bad); st != 400 {
			t.Fatalf("bad device accepted (%s): %d", bad, st)
		}
	}

	// A test alert reaches both phones, in French; the dead token is dropped.
	if st, _ := req(t, app, "POST", "/api/push/test", "alice", "{}"); st != 200 {
		t.Fatalf("test: %d", st)
	}
	if m := pushes.waitFor(t, "onSave"); !strings.Contains(m.Body, "activées") {
		t.Fatalf("not in French: %+v", m)
	}
	count := func() (n int) {
		_ = store.Pool().QueryRow(context.Background(), `SELECT count(*) FROM push_devices WHERE user_id = 'alice'`).Scan(&n)
		return
	}
	for i := 0; i < 100 && count() != 2; i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if n := count(); n != 2 {
		t.Fatalf("devices left: %d", n)
	}
	got := strings.Join(pushes.phones(), " ")
	for _, want := range []string{"ios:" + iphone, "android:" + android} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %s in %s", want, got)
		}
	}

	// Signing in as someone else on the same phone moves the token to them.
	if st, _ := req(t, app, "POST", "/api/push/device", "bob", `{"platform":"ios","token":"`+iphone+`"}`); st != 200 {
		t.Fatalf("bob register: %d", st)
	}
	if n := count(); n != 1 {
		t.Fatalf("token not moved: %d", n)
	}
	// Only the owner can remove it.
	req(t, app, "POST", "/api/push/device/remove", "alice", `{"token":"`+iphone+`"}`)
	var owner string
	_ = store.Pool().QueryRow(context.Background(), `SELECT user_id FROM push_devices WHERE token = $1`, iphone).Scan(&owner)
	if owner != "bob" {
		t.Fatalf("alice removed bob's phone: %q", owner)
	}
	if st, _ := req(t, app, "POST", "/api/push/device/remove", "bob", `{"token":"`+iphone+`"}`); st != 200 {
		t.Fatalf("remove: %d", st)
	}
	var left int
	_ = store.Pool().QueryRow(context.Background(), `SELECT count(*) FROM push_devices WHERE token = $1`, iphone).Scan(&left)
	if left != 0 {
		t.Fatalf("not removed")
	}
}
