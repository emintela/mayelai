package push

// Alerts for the onSave phone app: Apple Push Notification service for
// iPhone, Firebase Cloud Messaging for Android. Both sign short-lived JWTs
// with the standard library; no SDKs.

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var b64 = base64.RawURLEncoding

func jwtPart(v any) string {
	b, _ := json.Marshal(v)
	return b64.EncodeToString(b)
}

func parsePKCS8(pemText string) (any, error) {
	block, _ := pem.Decode([]byte(strings.ReplaceAll(strings.TrimSpace(pemText), `\n`, "\n")))
	if block == nil {
		return nil, errors.New("no PEM key found")
	}
	return x509.ParsePKCS8PrivateKey(block.Bytes)
}

var client = &http.Client{Timeout: 15 * time.Second}

// ---------- Firebase Cloud Messaging (Android) ----------

type fcmClient struct {
	projectID, email, tokenURI string
	key                        *rsa.PrivateKey
	sendBase                   string // https://fcm.googleapis.com (tests replace it)

	mu      sync.Mutex
	access  string
	expires time.Time
}

// newFCM reads a Firebase service account JSON (Project settings → Service accounts).
func newFCM(serviceAccount string) (*fcmClient, error) {
	var sa struct {
		ProjectID   string `json:"project_id"`
		ClientEmail string `json:"client_email"`
		PrivateKey  string `json:"private_key"`
		TokenURI    string `json:"token_uri"`
	}
	if err := json.Unmarshal([]byte(serviceAccount), &sa); err != nil {
		return nil, fmt.Errorf("service account JSON: %w", err)
	}
	if sa.ProjectID == "" || sa.ClientEmail == "" || sa.PrivateKey == "" {
		return nil, errors.New("service account JSON is missing project_id, client_email or private_key")
	}
	k, err := parsePKCS8(sa.PrivateKey)
	if err != nil {
		return nil, err
	}
	rk, ok := k.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("service account key is not RSA")
	}
	if sa.TokenURI == "" {
		sa.TokenURI = "https://oauth2.googleapis.com/token"
	}
	return &fcmClient{projectID: sa.ProjectID, email: sa.ClientEmail, tokenURI: sa.TokenURI, key: rk, sendBase: "https://fcm.googleapis.com"}, nil
}

func (f *fcmClient) token(ctx context.Context) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.access != "" && time.Until(f.expires) > time.Minute {
		return f.access, nil
	}
	now := time.Now()
	unsigned := jwtPart(map[string]string{"alg": "RS256", "typ": "JWT"}) + "." + jwtPart(map[string]any{
		"iss": f.email, "scope": "https://www.googleapis.com/auth/firebase.messaging",
		"aud": f.tokenURI, "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
	})
	sum := sha256.Sum256([]byte(unsigned))
	sig, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, sum[:])
	if err != nil {
		return "", err
	}
	form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {unsigned + "." + b64.EncodeToString(sig)}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, f.tokenURI, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || resp.StatusCode != http.StatusOK || out.AccessToken == "" {
		return "", fmt.Errorf("firebase sign-in failed (%d)", resp.StatusCode)
	}
	f.access, f.expires = out.AccessToken, now.Add(time.Duration(out.ExpiresIn)*time.Second)
	return f.access, nil
}

// send returns gone=true when the phone no longer has the app (token is dead).
func (f *fcmClient) send(ctx context.Context, device string, m Message) (bool, error) {
	access, err := f.token(ctx)
	if err != nil {
		return false, err
	}
	android := map[string]any{"priority": "HIGH", "notification": map[string]any{"sound": "default"}}
	if m.Tag != "" {
		android["notification"].(map[string]any)["tag"] = m.Tag
	}
	body, _ := json.Marshal(map[string]any{"message": map[string]any{
		"token":        device,
		"notification": map[string]string{"title": m.Title, "body": m.Body},
		"data":         map[string]string{"url": m.URL},
		"android":      android,
	}})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, f.sendBase+"/v1/projects/"+f.projectID+"/messages:send", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	text, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	switch {
	case resp.StatusCode == http.StatusOK:
		return false, nil
	case resp.StatusCode == http.StatusNotFound || bytes.Contains(text, []byte("UNREGISTERED")):
		return true, nil
	default:
		return false, fmt.Errorf("firebase answered %d", resp.StatusCode)
	}
}

// ---------- Apple Push Notification service (iPhone) ----------

type apnsClient struct {
	keyID, teamID, topic string
	key                  *ecdsa.PrivateKey
	hosts                []string // production first, then sandbox (apps installed from Xcode)

	mu     sync.Mutex
	jwt    string
	issued time.Time
}

// newAPNs reads the .p8 key from Apple Developer → Keys (with Push Notifications enabled).
func newAPNs(p8, keyID, teamID, topic string) (*apnsClient, error) {
	if keyID == "" || teamID == "" || topic == "" {
		return nil, errors.New("APNS_KEY_ID, APNS_TEAM_ID and APNS_TOPIC are all needed")
	}
	k, err := parsePKCS8(p8)
	if err != nil {
		return nil, err
	}
	ek, ok := k.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("APNs key is not an EC key")
	}
	return &apnsClient{keyID: keyID, teamID: teamID, topic: topic, key: ek,
		hosts: []string{"https://api.push.apple.com", "https://api.sandbox.push.apple.com"}}, nil
}

// Apple wants a token newer than an hour, but not a fresh one per request.
func (a *apnsClient) bearer() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.jwt != "" && time.Since(a.issued) < 40*time.Minute {
		return a.jwt, nil
	}
	now := time.Now()
	unsigned := jwtPart(map[string]string{"alg": "ES256", "kid": a.keyID}) + "." + jwtPart(map[string]any{"iss": a.teamID, "iat": now.Unix()})
	sum := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, a.key, sum[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	a.jwt, a.issued = unsigned+"."+b64.EncodeToString(sig), now
	return a.jwt, nil
}

func (a *apnsClient) send(ctx context.Context, device string, m Message) (bool, error) {
	bearer, err := a.bearer()
	if err != nil {
		return false, err
	}
	body, _ := json.Marshal(map[string]any{
		"aps": map[string]any{"alert": map[string]string{"title": m.Title, "body": m.Body}, "sound": "default"},
		"url": m.URL,
	})
	for i, host := range a.hosts {
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, host+"/3/device/"+url.PathEscape(device), bytes.NewReader(body))
		req.Header.Set("authorization", "bearer "+bearer)
		req.Header.Set("apns-topic", a.topic)
		req.Header.Set("apns-push-type", "alert")
		req.Header.Set("apns-priority", "10")
		req.Header.Set("apns-expiration", fmt.Sprint(time.Now().Add(24*time.Hour).Unix()))
		if m.Tag != "" && len(m.Tag) <= 64 {
			req.Header.Set("apns-collapse-id", m.Tag)
		}
		resp, err := client.Do(req)
		if err != nil {
			return false, err
		}
		text, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		switch {
		case resp.StatusCode == http.StatusOK:
			return false, nil
		case resp.StatusCode == http.StatusGone:
			return true, nil
		case bytes.Contains(text, []byte("BadDeviceToken")):
			if i < len(a.hosts)-1 {
				continue // a test build's token: try the sandbox
			}
			return true, nil
		default:
			return false, fmt.Errorf("apple answered %d %s", resp.StatusCode, bytes.TrimSpace(text))
		}
	}
	return false, nil
}
