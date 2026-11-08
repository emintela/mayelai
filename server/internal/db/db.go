// Package db stores conversations, messages, usage and cached responses in Postgres.
package db

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

var ErrNotFound = errors.New("not found")

type Store struct{ pool *pgxpool.Pool }

// Open connects to Postgres and applies the schema.
func Open(ctx context.Context, url string) (*Store, error) {
	if url == "" {
		return nil, errors.New("DATABASE_URL is not set")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	cfg.MaxConns = 10
	// Keep a couple of connections open so requests don't pay for a new TLS
	// handshake to the database after a quiet period.
	cfg.MinConns = 2
	cfg.MaxConnIdleTime = 30 * time.Minute
	cfg.HealthCheckPeriod = time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx, schema); err != nil {
		pool.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

type Conversation struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Summary      string    `json:"-"`
	SummaryCount int       `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Snippet      string    `json:"snippet,omitempty"` // matching message text, for search results
}

type Message struct {
	ID        int64          `json:"id"`
	Role      string         `json:"role"`
	Content   string         `json:"content"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	Feedback  int            `json:"feedback"` // 1 like, -1 dislike, 0 none
	CreatedAt time.Time      `json:"createdAt"`
}

// ListConversations returns the user's conversations, newest first. If query
// is non-empty, only conversations whose title or any message contains it
// (case-insensitive) are returned, with a snippet of the matching message.
func (s *Store) ListConversations(ctx context.Context, userID, query string, limit int) ([]Conversation, error) {
	var rows pgx.Rows
	var err error
	if query == "" {
		rows, err = s.pool.Query(ctx, `
			SELECT id, title, created_at, updated_at, ''
			FROM conversations WHERE user_id = $1
			ORDER BY updated_at DESC LIMIT $2`, userID, limit)
	} else {
		pattern := "%" + escapeLike(query) + "%"
		rows, err = s.pool.Query(ctx, `
			SELECT c.id, c.title, c.created_at, c.updated_at, COALESCE(m.content, '')
			FROM conversations c
			LEFT JOIN LATERAL (
				SELECT content FROM messages
				WHERE conversation_id = c.id AND content ILIKE $2
				ORDER BY id DESC LIMIT 1
			) m ON true
			WHERE c.user_id = $1 AND (c.title ILIKE $2 OR m.content IS NOT NULL)
			ORDER BY c.updated_at DESC LIMIT $3`, userID, pattern, limit)
	}
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Conversation, error) {
		var c Conversation
		err := r.Scan(&c.ID, &c.Title, &c.CreatedAt, &c.UpdatedAt, &c.Snippet)
		c.Snippet = snippet(c.Snippet, query)
		return c, err
	})
	if out == nil {
		out = []Conversation{}
	}
	return out, err
}

// GetConversation returns a conversation only if it belongs to userID.
func (s *Store) GetConversation(ctx context.Context, userID, id string) (*Conversation, error) {
	var c Conversation
	err := s.pool.QueryRow(ctx, `
		SELECT id, title, summary, summary_count, created_at, updated_at
		FROM conversations WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&c.ID, &c.Title, &c.Summary, &c.SummaryCount, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return nil, ErrNotFound
	}
	return &c, err
}

// Messages returns a conversation's messages in order, skipping the first offset.
func (s *Store) Messages(ctx context.Context, conversationID string, offset int) ([]Message, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+messageColumns+` FROM messages
		WHERE conversation_id = $1 ORDER BY id OFFSET $2`, conversationID, offset)
	if err != nil {
		return nil, err
	}
	return collectMessages(rows)
}

const messageColumns = `id, role, content, metadata, feedback, created_at`

func collectMessages(rows pgx.Rows) ([]Message, error) {
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Message, error) {
		var m Message
		err := r.Scan(&m.ID, &m.Role, &m.Content, &m.Metadata, &m.Feedback, &m.CreatedAt)
		return m, err
	})
	if out == nil {
		out = []Message{}
	}
	return out, err
}

// SetFeedback records a like (1), dislike (-1) or neither (0) on one of the
// user's assistant messages.
func (s *Store) SetFeedback(ctx context.Context, userID string, messageID int64, value int) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE messages SET feedback = $3
		WHERE id = $1 AND user_id = $2 AND role = 'assistant'`, messageID, userID, value)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// ChatState is everything needed before generating a reply, loaded in a
// single database round trip by LoadChat.
type ChatState struct {
	Plan                         string // "free" or "pro"
	RequestsToday, SearchesToday int
	Conversation                 *Conversation // nil for a new chat
	History                      []Message     // messages not yet covered by the summary
	CachedResponse               string        // "" if none
}

// LoadChat loads today's usage, the conversation (if conversationID is set,
// and only if it belongs to userID), its unsummarized history and, if
// cacheKey is set, a cached response — all in one round trip.
func (s *Store) LoadChat(ctx context.Context, userID, conversationID, cacheKey string, cacheTTL time.Duration) (*ChatState, error) {
	if conversationID != "" {
		if _, err := uuid.Parse(conversationID); err != nil {
			return nil, ErrNotFound
		}
	}
	b := &pgx.Batch{}
	b.Queue(planQuery, userID)
	b.Queue(`SELECT requests, searches FROM usage_daily
		WHERE user_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date`, userID)
	if conversationID != "" {
		b.Queue(`SELECT id, title, summary, summary_count, created_at, updated_at
			FROM conversations WHERE id = $1 AND user_id = $2`, conversationID, userID)
		b.Queue(`SELECT `+messageColumns+` FROM messages
			WHERE conversation_id = $1 AND user_id = $2 ORDER BY id
			OFFSET COALESCE((SELECT summary_count FROM conversations WHERE id = $1 AND user_id = $2), 0)`,
			conversationID, userID)
	}
	if cacheKey != "" {
		b.Queue(`UPDATE response_cache SET hits = hits + 1
			WHERE key = $1 AND created_at > now() - $2::interval RETURNING response`, cacheKey, cacheTTL.String())
	}

	br := s.pool.SendBatch(ctx, b)
	defer br.Close()

	st := &ChatState{}
	if err := br.QueryRow().Scan(&st.Plan); err != nil {
		return nil, err
	}
	if err := br.QueryRow().Scan(&st.RequestsToday, &st.SearchesToday); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if conversationID != "" {
		var c Conversation
		err := br.QueryRow().Scan(&c.ID, &c.Title, &c.Summary, &c.SummaryCount, &c.CreatedAt, &c.UpdatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		} else if err != nil {
			return nil, err
		}
		st.Conversation = &c
		rows, err := br.Query()
		if err != nil {
			return nil, err
		}
		if st.History, err = collectMessages(rows); err != nil {
			return nil, err
		}
	}
	if cacheKey != "" {
		if err := br.QueryRow().Scan(&st.CachedResponse); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	return st, br.Close()
}

// SaveChat stores the user's message and the assistant's reply (creating the
// conversation if conversationID is empty), adds usage to today's totals and
// optionally caches the response — atomically, in one round trip.
func (s *Store) SaveChat(ctx context.Context, userID, conversationID, title string,
	user, assistant Message, usage Usage, cacheKey, cacheResponse string) (Conversation, Message, Message, error) {
	var conv Conversation
	b := &pgx.Batch{}
	if conversationID == "" {
		conversationID = uuid.NewString()
		b.Queue(`INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3)
			RETURNING id, title, created_at, updated_at`, conversationID, userID, title)
	} else {
		b.Queue(`UPDATE conversations SET updated_at = now() WHERE id = $1 AND user_id = $2
			RETURNING id, title, created_at, updated_at`, conversationID, userID)
	}
	for _, m := range []*Message{&user, &assistant} {
		meta, _ := json.Marshal(orEmpty(m.Metadata))
		// The SELECT ... FROM conversations makes the insert a no-op unless the
		// conversation belongs to the user.
		b.Queue(`INSERT INTO messages (conversation_id, user_id, role, content, metadata)
			SELECT id, user_id, $3, $4, $5 FROM conversations WHERE id = $1 AND user_id = $2
			RETURNING id, created_at`, conversationID, userID, m.Role, m.Content, meta)
	}
	queueUsage(b, userID, usage)
	if cacheKey != "" && cacheResponse != "" {
		b.Queue(`INSERT INTO response_cache (key, response) VALUES ($1, $2)
			ON CONFLICT (key) DO UPDATE SET response = EXCLUDED.response, created_at = now(), hits = 0`,
			cacheKey, cacheResponse)
	}

	br := s.pool.SendBatch(ctx, b)
	defer br.Close()
	if err := br.QueryRow().Scan(&conv.ID, &conv.Title, &conv.CreatedAt, &conv.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			err = ErrNotFound
		}
		return conv, user, assistant, err
	}
	for _, m := range []*Message{&user, &assistant} {
		if err := br.QueryRow().Scan(&m.ID, &m.CreatedAt); err != nil {
			return conv, user, assistant, err
		}
	}
	return conv, user, assistant, br.Close()
}

// UpdateSummary stores a new rolling summary covering the first count
// messages, but only if the stored summary still covers prevCount (so two
// concurrent summarizations can't overwrite each other out of order).
func (s *Store) UpdateSummary(ctx context.Context, conversationID, summary string, prevCount, count int) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE conversations SET summary = $2, summary_count = $4
		WHERE id = $1 AND summary_count = $3`,
		conversationID, summary, prevCount, count)
	return err
}

// DeleteConversation deletes one of the user's conversations and its messages.
func (s *Store) DeleteConversation(ctx context.Context, userID, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM conversations WHERE id = $1 AND user_id = $2`, id, userID)
	if isInvalidUUID(err) || (err == nil && tag.RowsAffected() == 0) {
		return ErrNotFound
	}
	return err
}

// DeleteAllConversations deletes all of the user's chat history.
func (s *Store) DeleteAllConversations(ctx context.Context, userID string) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM conversations WHERE user_id = $1`, userID)
	return tag.RowsAffected(), err
}

// --- usage & quotas ---

// Usage is added to a user's daily totals.
type Usage struct {
	Requests, Searches, CacheHits                int
	PromptTokens, CachedTokens, CompletionTokens int
}

// UsageToday returns the user's plan and their chat requests and AI searches this UTC day.
func (s *Store) UsageToday(ctx context.Context, userID string) (plan string, requests, searches int, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT (`+planQuery+`),
			COALESCE(u.requests, 0), COALESCE(u.searches, 0)
		FROM (SELECT 1) AS one
		LEFT JOIN usage_daily u ON u.user_id = $1 AND u.day = (now() AT TIME ZONE 'UTC')::date`,
		userID).Scan(&plan, &requests, &searches)
	return plan, requests, searches, err
}

// RecordUsage adds u to the user's totals for today.
func (s *Store) RecordUsage(ctx context.Context, userID string, u Usage) error {
	b := &pgx.Batch{}
	queueUsage(b, userID, u)
	return s.pool.SendBatch(ctx, b).Close()
}

func queueUsage(b *pgx.Batch, userID string, u Usage) {
	b.Queue(`
		INSERT INTO usage_daily (user_id, day, requests, searches, cache_hits, prompt_tokens, cached_tokens, completion_tokens)
		VALUES ($1, (now() AT TIME ZONE 'UTC')::date, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id, day) DO UPDATE SET
			requests          = usage_daily.requests + EXCLUDED.requests,
			searches          = usage_daily.searches + EXCLUDED.searches,
			cache_hits        = usage_daily.cache_hits + EXCLUDED.cache_hits,
			prompt_tokens     = usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
			cached_tokens     = usage_daily.cached_tokens + EXCLUDED.cached_tokens,
			completion_tokens = usage_daily.completion_tokens + EXCLUDED.completion_tokens`,
		userID, u.Requests, u.Searches, u.CacheHits, u.PromptTokens, u.CachedTokens, u.CompletionTokens)
}

// --- billing ---

// planQuery returns 'pro' if the user has a paid plan in good standing, else 'free'.
const planQuery = `SELECT COALESCE((
	SELECT plan FROM subscriptions
	WHERE user_id = $1 AND plan <> 'free'
	  AND status IN ('active', 'trialing', 'past_due')
	  AND (current_period_end IS NULL OR current_period_end > now())
), 'free')`

type Subscription struct {
	Plan              string     `json:"plan"`   // effective plan: "free" or "pro"
	Status            string     `json:"status"` // provider status, e.g. active, canceled, none
	CurrentPeriodEnd  *time.Time `json:"currentPeriodEnd,omitempty"`
	CancelAtPeriodEnd bool       `json:"cancelAtPeriodEnd"`
	CustomerID        string     `json:"-"`
}

// GetSubscription returns the user's billing state (plan "free", status "none" if never subscribed).
func (s *Store) GetSubscription(ctx context.Context, userID string) (Subscription, error) {
	sub := Subscription{Plan: "free", Status: "none"}
	var customer *string
	err := s.pool.QueryRow(ctx, `
		SELECT (`+planQuery+`), status, current_period_end, cancel_at_period_end, provider_customer_id
		FROM subscriptions WHERE user_id = $1`, userID,
	).Scan(&sub.Plan, &sub.Status, &sub.CurrentPeriodEnd, &sub.CancelAtPeriodEnd, &customer)
	if errors.Is(err, pgx.ErrNoRows) {
		return sub, nil
	}
	if customer != nil {
		sub.CustomerID = *customer
	}
	return sub, err
}

// SetCustomerID links a payment-provider customer to the user (the first one
// stored wins) and returns the stored customer ID.
func (s *Store) SetCustomerID(ctx context.Context, userID, provider, customerID string) (string, error) {
	var stored *string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO subscriptions (user_id, provider, provider_customer_id) VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
			SET provider_customer_id = COALESCE(subscriptions.provider_customer_id, EXCLUDED.provider_customer_id)
		RETURNING provider_customer_id`, userID, provider, customerID).Scan(&stored)
	if err != nil || stored == nil {
		return customerID, err
	}
	return *stored, nil
}

// SubscriptionUpdate is a subscription's state as reported by a provider webhook.
type SubscriptionUpdate struct {
	UserID            string // may be empty; then the user is found by CustomerID
	Provider          string
	CustomerID        string
	SubscriptionID    string
	Plan              string
	Status            string
	CurrentPeriodEnd  *time.Time
	CancelAtPeriodEnd bool
	EventAt           time.Time
}

// ApplySubscriptionUpdate stores a webhook's subscription state unless a newer
// event was already applied. It reports whether the update matched a user.
func (s *Store) ApplySubscriptionUpdate(ctx context.Context, u SubscriptionUpdate) (bool, error) {
	userID := u.UserID
	if userID == "" {
		err := s.pool.QueryRow(ctx, `SELECT user_id FROM subscriptions WHERE provider_customer_id = $1`,
			u.CustomerID).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		} else if err != nil {
			return false, err
		}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO subscriptions (user_id, provider, provider_customer_id, provider_subscription_id,
			plan, status, current_period_end, cancel_at_period_end, provider_event_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
		ON CONFLICT (user_id) DO UPDATE SET
			provider                 = EXCLUDED.provider,
			provider_customer_id     = EXCLUDED.provider_customer_id,
			provider_subscription_id = EXCLUDED.provider_subscription_id,
			plan                     = EXCLUDED.plan,
			status                   = EXCLUDED.status,
			current_period_end       = EXCLUDED.current_period_end,
			cancel_at_period_end     = EXCLUDED.cancel_at_period_end,
			provider_event_at        = EXCLUDED.provider_event_at,
			updated_at               = now()
		WHERE subscriptions.provider_event_at IS NULL
		   OR subscriptions.provider_event_at <= EXCLUDED.provider_event_at`,
		userID, u.Provider, u.CustomerID, u.SubscriptionID, u.Plan, u.Status,
		u.CurrentPeriodEnd, u.CancelAtPeriodEnd, u.EventAt)
	return true, err
}

// --- response cache ---

// PruneCache deletes cached responses older than ttl.
func (s *Store) PruneCache(ctx context.Context, ttl time.Duration) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM response_cache WHERE created_at < now() - $1::interval`, ttl.String())
	return err
}

// --- helpers ---

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// snippet returns ~120 characters of text around the first match of query.
func snippet(text, query string) string {
	if text == "" || query == "" {
		return ""
	}
	r := []rune(text)
	idx := strings.Index(strings.ToLower(text), strings.ToLower(query))
	start := 0
	if idx > 0 {
		start = len([]rune(text[:idx])) - 40
	}
	if start < 0 {
		start = 0
	}
	end := start + 120
	if end > len(r) {
		end = len(r)
	}
	out := strings.Join(strings.Fields(string(r[start:end])), " ")
	if start > 0 {
		out = "…" + out
	}
	if end < len(r) {
		out += "…"
	}
	return out
}

// isInvalidUUID reports whether Postgres rejected a malformed UUID (SQLSTATE 22P02),
// which we treat as "not found".
func isInvalidUUID(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}

func orEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}
