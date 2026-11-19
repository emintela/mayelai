// Package push sends Web Push notifications (Android, desktop, and iPhone
// when the app is added to the Home Screen). It is optional: without VAPID
// keys every method is a no-op and Enabled() is false.
package push

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
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
}

// New returns nil when the keys aren't set (push disabled). subject is a
// mailto: or https: URL identifying the sender to the push services.
func New(pool *pgxpool.Pool, publicKey, privateKey, subject string) *Service {
	if publicKey == "" || privateKey == "" {
		return nil
	}
	return &Service{pool: pool, publicKey: publicKey, privateKey: privateKey, subject: subject, send: webpush.SendNotification}
}

func (s *Service) Enabled() bool { return s != nil }

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
	if s == nil {
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

// GenerateKeys makes a new VAPID key pair (private, public).
func GenerateKeys() (string, string, error) { return webpush.GenerateVAPIDKeys() }

// WithSender replaces the network call (tests).
func (s *Service) WithSender(f func(payload []byte, sub *webpush.Subscription, o *webpush.Options) (*http.Response, error)) *Service {
	s.send = f
	return s
}
