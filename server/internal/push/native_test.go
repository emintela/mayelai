package push

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func pemKey(t *testing.T, k any) string {
	b, err := x509.MarshalPKCS8PrivateKey(k)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}))
}

func splitJWT(t *testing.T, jwt string) (unsigned string, claims map[string]any, sig []byte) {
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		t.Fatalf("not a JWT: %q", jwt)
	}
	raw, _ := b64.DecodeString(parts[1])
	_ = json.Unmarshal(raw, &claims)
	sig, _ = b64.DecodeString(parts[2])
	return parts[0] + "." + parts[1], claims, sig
}

func TestFCM(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	var sent map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			_ = r.ParseForm()
			unsigned, claims, sig := splitJWT(t, r.Form.Get("assertion"))
			sum := sha256.Sum256([]byte(unsigned))
			if err := rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, sum[:], sig); err != nil || claims["iss"] != "bot@p.iam" {
				w.WriteHeader(401)
				return
			}
			_, _ = io.WriteString(w, `{"access_token":"ya29.ok","expires_in":3600}`)
		case "/v1/projects/proj-1/messages:send":
			if r.Header.Get("Authorization") != "Bearer ya29.ok" {
				w.WriteHeader(401)
				return
			}
			_ = json.NewDecoder(r.Body).Decode(&sent)
			if sent["message"].(map[string]any)["token"] == "gone-token" {
				w.WriteHeader(404)
				_, _ = io.WriteString(w, `{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}`)
				return
			}
			_, _ = io.WriteString(w, `{"name":"projects/proj-1/messages/1"}`)
		}
	}))
	defer srv.Close()
	sa, _ := json.Marshal(map[string]string{"project_id": "proj-1", "client_email": "bot@p.iam", "private_key": pemKey(t, key), "token_uri": srv.URL + "/token"})
	f, err := newFCM(string(sa))
	if err != nil {
		t.Fatal(err)
	}
	f.sendBase = srv.URL
	gone, err := f.send(context.Background(), "phone-token", Message{Title: "Hi", Body: "There", URL: "/onsave/money", Tag: "t1"})
	if err != nil || gone {
		t.Fatalf("send: %v %v", gone, err)
	}
	msg := sent["message"].(map[string]any)
	if msg["data"].(map[string]any)["url"] != "/onsave/money" || msg["notification"].(map[string]any)["title"] != "Hi" {
		t.Fatalf("payload: %+v", msg)
	}
	if gone, err := f.send(context.Background(), "gone-token", Message{}); err != nil || !gone {
		t.Fatalf("gone: %v %v", gone, err)
	}
	if _, err := newFCM(`{"project_id":"x"}`); err == nil {
		t.Fatal("incomplete service account accepted")
	}
}

func TestAPNs(t *testing.T) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	var hits []string
	handler := func(sandbox bool) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			hits = append(hits, map[bool]string{false: "prod", true: "sandbox"}[sandbox]+r.URL.Path)
			unsigned, claims, sig := splitJWT(t, strings.TrimPrefix(r.Header.Get("authorization"), "bearer "))
			sum := sha256.Sum256([]byte(unsigned))
			rr, ss := new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])
			if !ecdsa.Verify(&key.PublicKey, sum[:], rr, ss) || claims["iss"] != "TEAM123456" || r.Header.Get("apns-topic") != "com.mayelai.onsave" {
				w.WriteHeader(403)
				return
			}
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["url"] != "/onsave" {
				w.WriteHeader(400)
				return
			}
			switch {
			case strings.HasSuffix(r.URL.Path, "/devtoken") && !sandbox, strings.HasSuffix(r.URL.Path, "/badtoken"):
				w.WriteHeader(400)
				_, _ = io.WriteString(w, `{"reason":"BadDeviceToken"}`)
			case strings.HasSuffix(r.URL.Path, "/oldtoken"):
				w.WriteHeader(410)
			default:
				w.WriteHeader(200)
			}
		}
	}
	prod, sand := httptest.NewServer(handler(false)), httptest.NewServer(handler(true))
	defer prod.Close()
	defer sand.Close()
	a, err := newAPNs(pemKey(t, key), "KEY1234567", "TEAM123456", "com.mayelai.onsave")
	if err != nil {
		t.Fatal(err)
	}
	a.hosts = []string{prod.URL, sand.URL}
	m := Message{Title: "Hi", Body: "There", URL: "/onsave"}
	for token, wantGone := range map[string]bool{"apptoken": false, "devtoken": false, "oldtoken": true, "badtoken": true} {
		gone, err := a.send(context.Background(), token, m)
		if err != nil || gone != wantGone {
			t.Fatalf("%s: gone=%v err=%v", token, gone, err)
		}
	}
	if !strings.Contains(strings.Join(hits, " "), "sandbox/3/device/devtoken") {
		t.Fatalf("test-build token didn't try the sandbox: %v", hits)
	}
	if _, err := newAPNs(pemKey(t, key), "", "TEAM", "x"); err == nil {
		t.Fatal("missing key ID accepted")
	}
}
