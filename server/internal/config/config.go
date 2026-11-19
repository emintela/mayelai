// Package config reads server settings from environment variables.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// DefaultSystemPrompt is sent first on every chat request. Keep it stable:
// OpenAI automatically discounts repeated prompt prefixes (prompt caching),
// so changing it per request would lose that discount. Override with
// SYSTEM_PROMPT to specialize the assistant for your domain.
const DefaultSystemPrompt = `You are Mayel'AI, a helpful, accurate assistant.
Answer clearly and concisely. Reply in the same language the user writes in (for example French, Lingala, Swahili or English).
If you don't know something or it requires up-to-date information, say so plainly instead of guessing.`

type Config struct {
	Port        string
	DatabaseURL string
	StaticDir   string // built frontend (dist/); empty = don't serve it

	OpenAIKey       string
	ChatModel       string // default model for chat
	SearchModel     string // web-search-enabled model, used only when the user asks for AI Search
	SummaryModel    string // model used to summarize old history
	ReasoningEffort string // for reasoning models (gpt-5 family); "" = don't send
	SystemPrompt    string

	// Main public domain (e.g. "mayelai.com"); requests to RedirectHosts are
	// redirected there. Empty = no redirects.
	CanonicalHost     string
	RedirectHosts     []string
	ClerkSecretKey    string
	AuthorizedOrigins []string // allowed values for the token's azp claim; empty = don't check

	// Billing (Stripe). Billing is disabled unless all three keys are set.
	AppURL string // public URL of the frontend, for Stripe redirects
	// Web push (alerts). Both keys empty = push off. Subject: mailto: or https: URL.
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
	// Phone app alerts: Firebase service account JSON (Android); Apple .p8 key, key ID, team ID, bundle ID (iPhone).
	FCMServiceAccount                         string
	APNsKey, APNsKeyID, APNsTeamID, APNsTopic string
	// AI Fin (Plaid). PlaidEnv: sandbox | production. FinTokenKey: base64 32-byte key encrypting Plaid tokens.
	PlaidClientID, PlaidSecret, PlaidEnv, FinTokenKey string
	StripeSecretKey                                   string
	StripeWebhookSecret                               string
	StripeProPriceID                                  string // recurring Price for the Pro plan (price_...)

	// Cost controls
	MaxOutputTokens int // cap on each reply's length
	MaxInputChars   int // reject longer user messages
	// Attachments
	MaxAttachments     int    // files per message
	MaxAttachmentBytes int    // per file, after base64 decoding
	MaxAttachmentChars int    // total text extracted from files per message
	ImageDetail        string // "low" (cheapest), "high" or "auto"
	HistoryMessages    int    // most recent messages sent verbatim
	SummaryBatch       int    // summarize once this many extra old messages pile up
	Free               Limits // daily limits for free users
	Pro                Limits // daily limits for paying users ("unlimited" with a fair-use cap)
	PerMinuteLimit     int    // per-user burst limit
	// Family money: open loans allowed per plan (0 = unlimited).
	FreeOpenLoans int
	ProOpenLoans  int
	// Collections (family events): open collections allowed per plan (0 = unlimited).
	FreeOpenCollections int
	ProOpenCollections  int
	// Likelemba groups (forming or active) allowed per plan (0 = unlimited).
	FreeActiveGroups int
	ProActiveGroups  int
	CacheEnabled     bool // reuse answers to identical first questions
	CacheTTL         time.Duration
}

func Load() Config {
	return Config{
		Port:        env("PORT", "3001"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		StaticDir:   os.Getenv("STATIC_DIR"),

		OpenAIKey:       os.Getenv("OPENAI_API_KEY"),
		ChatModel:       env("OPENAI_MODEL", "gpt-5-nano"),
		SearchModel:     env("OPENAI_SEARCH_MODEL", "gpt-5-search-api"),
		SummaryModel:    env("OPENAI_SUMMARY_MODEL", "gpt-5-nano"),
		ReasoningEffort: env("OPENAI_REASONING_EFFORT", "minimal"),
		SystemPrompt:    env("SYSTEM_PROMPT", DefaultSystemPrompt),

		CanonicalHost:     strings.ToLower(os.Getenv("CANONICAL_HOST")),
		RedirectHosts:     list(os.Getenv("REDIRECT_HOSTS")),
		ClerkSecretKey:    os.Getenv("CLERK_SECRET_KEY"),
		AuthorizedOrigins: list(os.Getenv("CLERK_AUTHORIZED_PARTIES")),

		AppURL:              strings.TrimRight(env("APP_URL", "http://localhost:5173"), "/"),
		VAPIDPublicKey:      os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey:     os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDSubject:        os.Getenv("VAPID_SUBJECT"),
		FCMServiceAccount:   os.Getenv("FCM_SERVICE_ACCOUNT"),
		APNsKey:             os.Getenv("APNS_KEY"),
		APNsKeyID:           os.Getenv("APNS_KEY_ID"),
		APNsTeamID:          os.Getenv("APNS_TEAM_ID"),
		APNsTopic:           env("APNS_TOPIC", "com.mayelai.onsave"),
		PlaidClientID:       os.Getenv("PLAID_CLIENT_ID"),
		PlaidSecret:         os.Getenv("PLAID_SECRET"),
		PlaidEnv:            env("PLAID_ENV", "sandbox"),
		FinTokenKey:         os.Getenv("FIN_TOKEN_KEY"),
		StripeSecretKey:     os.Getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecret: os.Getenv("STRIPE_WEBHOOK_SECRET"),
		StripeProPriceID:    os.Getenv("STRIPE_PRO_PRICE_ID"),

		MaxOutputTokens:     envInt("MAX_OUTPUT_TOKENS", 1200),
		MaxInputChars:       envInt("MAX_INPUT_CHARS", 4000),
		MaxAttachments:      envInt("MAX_ATTACHMENTS", 5),
		MaxAttachmentBytes:  envInt("MAX_ATTACHMENT_MB", 8) << 20,
		MaxAttachmentChars:  envInt("MAX_ATTACHMENT_CHARS", 30000),
		ImageDetail:         env("IMAGE_DETAIL", "auto"),
		HistoryMessages:     envInt("HISTORY_MESSAGES", 10),
		SummaryBatch:        envInt("SUMMARY_BATCH", 10),
		Free:                Limits{Messages: envInt("FREE_DAILY_MESSAGES", 20), Searches: envInt("FREE_DAILY_SEARCHES", 2)},
		Pro:                 Limits{Messages: envInt("PRO_DAILY_MESSAGES", 300), Searches: envInt("PRO_DAILY_SEARCHES", 30)},
		PerMinuteLimit:      envInt("PER_MINUTE_LIMIT", 15),
		FreeOpenLoans:       envInt("FREE_OPEN_LOANS", 3),
		ProOpenLoans:        envInt("PRO_OPEN_LOANS", 0),
		FreeOpenCollections: envInt("FREE_OPEN_COLLECTIONS", 1),
		ProOpenCollections:  envInt("PRO_OPEN_COLLECTIONS", 0),
		FreeActiveGroups:    envInt("FREE_ACTIVE_GROUPS", 1),
		ProActiveGroups:     envInt("PRO_ACTIVE_GROUPS", 0),
		CacheEnabled:        env("RESPONSE_CACHE", "true") == "true",
		CacheTTL:            time.Duration(envInt("RESPONSE_CACHE_TTL_HOURS", 168)) * time.Hour,
	}
}

// Limits are per-user, per-UTC-day caps. 0 means unlimited.
type Limits struct {
	Messages int `json:"messages"`
	Searches int `json:"searches"`
}

// OpenLoansFor returns the open-loan cap for a plan (0 = unlimited).
func (c Config) OpenLoansFor(plan string) int {
	if plan == "pro" {
		return c.ProOpenLoans
	}
	return c.FreeOpenLoans
}

// OpenCollectionsFor returns the open-collection cap for a plan (0 = unlimited).
func (c Config) OpenCollectionsFor(plan string) int {
	if plan == "pro" {
		return c.ProOpenCollections
	}
	return c.FreeOpenCollections
}

// ActiveGroupsFor returns the likelemba group cap for a plan (0 = unlimited).
func (c Config) ActiveGroupsFor(plan string) int {
	if plan == "pro" {
		return c.ProActiveGroups
	}
	return c.FreeActiveGroups
}

// LimitsFor returns the limits for a plan ("free" or "pro").
func (c Config) LimitsFor(plan string) Limits {
	if plan == "pro" {
		return c.Pro
	}
	return c.Free
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key))); err == nil {
		return n
	}
	return def
}

func list(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// BillingEnabled reports whether Stripe is configured.
func (c Config) BillingEnabled() bool {
	return c.StripeSecretKey != "" && c.StripeWebhookSecret != "" && c.StripeProPriceID != ""
}
