// Package push sends alerts:
//   - Web Push (Android, desktop, and iPhone when the site is added to the Home Screen);
//   - the onSave phone app, through Apple (iPhone) and Firebase (Android), see native.go.
//
// Each part is optional. Without any keys New returns nil and every method is a no-op.
package push

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool                  *pgxpool.Pool
	publicKey, privateKey string
	subject               string
	send                  func(payload []byte, sub *webpush.Subscription, o *webpush.Options) (*http.Response, error)

	// Phone app: platform ("ios" | "android") → sender. Returns gone=true for a dead token.
	native map[string]func(ctx context.Context, token string, m Message) (bool, error)
}

type Config struct {
	// Web Push. Subject is a mailto: or https: URL identifying the sender.
	VAPIDPublicKey, VAPIDPrivateKey, Subject string
	// Android: the Firebase service account JSON.
	FCMServiceAccount string
	// iPhone: the .p8 key text, its key ID, the Apple team ID, and the app's bundle ID.
	APNsKey, APNsKeyID, APNsTeamID, APNsTopic string
}

// New returns nil when nothing is configured. A part whose keys don't load
// is left off and logged.
func New(pool *pgxpool.Pool, cfg Config) *Service {
	s := &Service{pool: pool, send: webpush.SendNotification, native: map[string]func(context.Context, string, Message) (bool, error){}}
	if cfg.VAPIDPublicKey != "" && cfg.VAPIDPrivateKey != "" {
		s.publicKey, s.privateKey, s.subject = cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.Subject
	}
	if cfg.FCMServiceAccount != "" {
		if f, err := newFCM(cfg.FCMServiceAccount); err != nil {
			log.Printf("[PUSH] Android alerts off: %v", err)
		} else {
			s.native["android"] = f.send
		}
	}
	if cfg.APNsKey != "" {
		if a, err := newAPNs(cfg.APNsKey, cfg.APNsKeyID, cfg.APNsTeamID, cfg.APNsTopic); err != nil {
			log.Printf("[PUSH] iPhone alerts off: %v", err)
		} else {
			s.native["ios"] = a.send
		}
	}
	if s.publicKey == "" && len(s.native) == 0 {
		return nil
	}
	return s
}

// Enabled reports whether Web Push works (browsers).
func (s *Service) Enabled() bool { return s != nil && s.publicKey != "" }

// NativeEnabled reports whether the phone app can get alerts on this platform.
func (s *Service) NativeEnabled(platform string) bool { return s != nil && s.native[platform] != nil }

func (s *Service) PublicKey() string {
	if s == nil {
		return ""
	}
	return s.publicKey
}

// Subscription is what the browser's PushManager.subscribe() returns.
type Subscription struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

var ErrInvalid = errors.New("invalid subscription")

func (s *Service) Subscribe(ctx context.Context, user string, sub Subscription, lang string) error {
	if !s.Enabled() {
		return nil
	}
	if !strings.HasPrefix(sub.Endpoint, "https://") || len(sub.Endpoint) > 1000 ||
		sub.Keys.P256dh == "" || len(sub.Keys.P256dh) > 200 || sub.Keys.Auth == "" || len(sub.Keys.Auth) > 100 {
		return ErrInvalid
	}
	if lang != "fr" {
		lang = "en"
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, lang)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, p256dh = $3, auth = $4, lang = $5`,
		sub.Endpoint, user, sub.Keys.P256dh, sub.Keys.Auth, lang)
	return err
}

func (s *Service) Unsubscribe(ctx context.Context, user, endpoint string) error {
	if s == nil {
		return nil
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, endpoint, user)
	return err
}

// Message is shown as a notification; URL opens when it's tapped.
type Message struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag,omitempty"` // a newer message with the same tag replaces the older one
}

// Notify sends to every device of the user, in each device's language, in
// the background. Dead subscriptions are removed.
func (s *Service) Notify(user string, msg func(lang string) Message) {
	if s == nil || user == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := s.notify(ctx, user, msg); err != nil {
			log.Printf("[PUSH] %v", err)
		}
	}()
}

func (s *Service) notify(ctx context.Context, user string, msg func(lang string) Message) error {
	if err := s.notifyDevices(ctx, user, msg); err != nil {
		log.Printf("[PUSH] phones: %v", err)
	}
	if !s.Enabled() {
		return nil
	}
	rows, err := s.pool.Query(ctx, `SELECT endpoint, p256dh, auth, lang FROM push_subscriptions WHERE user_id = $1`, user)
	if err != nil {
		return err
	}
	type sub struct{ endpoint, p256dh, auth, lang string }
	var subs []sub
	for rows.Next() {
		var x sub
		if err := rows.Scan(&x.endpoint, &x.p256dh, &x.auth, &x.lang); err != nil {
			rows.Close()
			return err
		}
		subs = append(subs, x)
	}
	rows.Close()
	for _, x := range subs {
		payload, _ := json.Marshal(msg(x.lang))
		ws := &webpush.Subscription{Endpoint: x.endpoint}
		ws.Keys.P256dh, ws.Keys.Auth = x.p256dh, x.auth
		resp, err := s.send(payload, ws, &webpush.Options{
			Subscriber: s.subject, VAPIDPublicKey: s.publicKey, VAPIDPrivateKey: s.privateKey,
			TTL: 24 * 60 * 60, Urgency: webpush.UrgencyHigh,
		})
		if err != nil {
			log.Printf("[PUSH] send: %v", err)
			continue
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
			_, _ = s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, x.endpoint)
		} else if resp.StatusCode >= 400 {
			log.Printf("[PUSH] push service answered %d", resp.StatusCode)
		}
	}
	return nil
}

// ---------- phone app ----------

var tokenOK = regexp.MustCompile(`^[A-Za-z0-9_:\-.]{20,400}$`)

// RegisterDevice saves the phone's token (from the app's push plugin).
// A token moves to whoever signed in on that phone last.
func (s *Service) RegisterDevice(ctx context.Context, user, platform, token, lang string) error {
	if !s.NativeEnabled(platform) {
		return nil
	}
	if !tokenOK.MatchString(token) {
		return ErrInvalid
	}
	if lang != "fr" {
		lang = "en"
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO push_devices (token, user_id, platform, lang) VALUES ($1, $2, $3, $4)
		ON CONFLICT (token) DO UPDATE SET user_id = $2, platform = $3, lang = $4, updated_at = now()`,
		token, user, platform, lang)
	return err
}

func (s *Service) RemoveDevice(ctx context.Context, user, token string) error {
	if s == nil {
		return nil
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM push_devices WHERE token = $1 AND user_id = $2`, token, user)
	return err
}

func (s *Service) notifyDevices(ctx context.Context, user string, msg func(lang string) Message) error {
	if len(s.native) == 0 {
		return nil
	}
	rows, err := s.pool.Query(ctx, `SELECT token, platform, lang FROM push_devices WHERE user_id = $1`, user)
	if err != nil {
		return err
	}
	type dev struct{ token, platform, lang string }
	var devs []dev
	for rows.Next() {
		var d dev
		if err := rows.Scan(&d.token, &d.platform, &d.lang); err != nil {
			rows.Close()
			return err
		}
		devs = append(devs, d)
	}
	rows.Close()
	for _, d := range devs {
		send := s.native[d.platform]
		if send == nil {
			continue
		}
		gone, err := send(ctx, d.token, msg(d.lang))
		if err != nil {
			log.Printf("[PUSH] %s: %v", d.platform, err)
			continue
		}
		if gone {
			_, _ = s.pool.Exec(ctx, `DELETE FROM push_devices WHERE token = $1`, d.token)
		}
	}
	return nil
}

// WithNativeSender replaces the Apple/Firebase call for one platform (tests).
func (s *Service) WithNativeSender(platform string, f func(ctx context.Context, token string, m Message) (bool, error)) *Service {
	s.native[platform] = f
	return s
}

// GenerateKeys makes a new VAPID key pair (private, public).
func GenerateKeys() (string, string, error) { return webpush.GenerateVAPIDKeys() }

// WithSender replaces the network call (tests).
func (s *Service) WithSender(f func(payload []byte, sub *webpush.Subscription, o *webpush.Options) (*http.Response, error)) *Service {
	s.send = f
	return s
}
