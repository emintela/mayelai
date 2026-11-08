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

	ClerkSecretKey    string
	AuthorizedOrigins []string // allowed values for the token's azp claim; empty = don't check

	// Billing (Stripe). Billing is disabled unless all three keys are set.
	AppURL              string // public URL of the frontend, for Stripe redirects
	StripeSecretKey     string
	StripeWebhookSecret string
	StripeProPriceID    string // recurring Price for the Pro plan (price_...)

	// Cost controls
	MaxOutputTokens int    // cap on each reply's length
	MaxInputChars   int    // reject longer user messages
	HistoryMessages int    // most recent messages sent verbatim
	SummaryBatch    int    // summarize once this many extra old messages pile up
	Free            Limits // daily limits for free users
	Pro             Limits // daily limits for paying users ("unlimited" with a fair-use cap)
	PerMinuteLimit  int    // per-user burst limit
	CacheEnabled    bool   // reuse answers to identical first questions
	CacheTTL        time.Duration
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

		ClerkSecretKey:    os.Getenv("CLERK_SECRET_KEY"),
		AuthorizedOrigins: list(os.Getenv("CLERK_AUTHORIZED_PARTIES")),

		AppURL:              strings.TrimRight(env("APP_URL", "http://localhost:5173"), "/"),
		StripeSecretKey:     os.Getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecret: os.Getenv("STRIPE_WEBHOOK_SECRET"),
		StripeProPriceID:    os.Getenv("STRIPE_PRO_PRICE_ID"),

		MaxOutputTokens: envInt("MAX_OUTPUT_TOKENS", 1200),
		MaxInputChars:   envInt("MAX_INPUT_CHARS", 4000),
		HistoryMessages: envInt("HISTORY_MESSAGES", 10),
		SummaryBatch:    envInt("SUMMARY_BATCH", 10),
		Free:            Limits{Messages: envInt("FREE_DAILY_MESSAGES", 20), Searches: envInt("FREE_DAILY_SEARCHES", 2)},
		Pro:             Limits{Messages: envInt("PRO_DAILY_MESSAGES", 300), Searches: envInt("PRO_DAILY_SEARCHES", 30)},
		PerMinuteLimit:  envInt("PER_MINUTE_LIMIT", 15),
		CacheEnabled:    env("RESPONSE_CACHE", "true") == "true",
		CacheTTL:        time.Duration(envInt("RESPONSE_CACHE_TTL_HOURS", 168)) * time.Hour,
	}
}

// Limits are per-user, per-UTC-day caps. 0 means unlimited.
type Limits struct {
	Messages int `json:"messages"`
	Searches int `json:"searches"`
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
