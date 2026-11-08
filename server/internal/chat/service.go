// Package chat generates assistant replies, persists them, and applies the
// cost-saving rules (quotas, history window + rolling summary, response cache).
package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
	"unicode"

	"mayelai/server/internal/config"
	"mayelai/server/internal/db"
	"mayelai/server/internal/openai"
)

const (
	ModeChat   = "chat"
	ModeSearch = "search"
)

// LimitError is returned when the user has used up a daily limit.
type LimitError struct {
	Kind string // "messages" or "searches"
	Plan string // the user's plan, so the client can offer an upgrade to free users
}

func (e *LimitError) Error() string { return "daily " + e.Kind + " limit reached" }

var (
	ErrTooLong = errors.New("message too long")
	ErrEmpty   = errors.New("message is empty")
	ErrNoReply = errors.New("the model returned an empty reply")
)

type Service struct {
	cfg   config.Config
	store *db.Store
	oa    *openai.Client

	bg          sync.WaitGroup // background summarizations
	summarizing sync.Map       // conversation ID -> struct{}, avoids duplicate work
}

func New(cfg config.Config, store *db.Store, oa *openai.Client) *Service {
	return &Service{cfg: cfg, store: store, oa: oa}
}

// Wait blocks until background work (summaries) has finished. Call on shutdown.
func (s *Service) Wait() { s.bg.Wait() }

type Quota struct {
	Plan        string `json:"plan"` // "free" or "pro"
	Used        int    `json:"used"`
	Limit       int    `json:"limit"` // 0 = unlimited
	Searches    int    `json:"searches"`
	SearchLimit int    `json:"searchLimit"`
}

func (s *Service) quota(plan string, used, searches int) Quota {
	l := s.cfg.LimitsFor(plan)
	return Quota{Plan: plan, Used: used, Limit: l.Messages, Searches: searches, SearchLimit: l.Searches}
}

func (s *Service) Quota(ctx context.Context, userID string) (Quota, error) {
	plan, req, srch, err := s.store.UsageToday(ctx, userID)
	return s.quota(plan, req, srch), err
}

type Reply struct {
	Conversation     db.Conversation `json:"conversation"`
	UserMessage      db.Message      `json:"userMessage"`
	AssistantMessage db.Message      `json:"assistantMessage"`
	SearchSuggestion bool            `json:"searchSuggestion"`
	Quota            Quota           `json:"quota"`
}

// Send adds the user's message to a conversation (a new one if
// conversationID is empty), gets the assistant's reply, and stores both.
// The database is hit exactly twice: once before calling the model and once after.
func (s *Service) Send(ctx context.Context, userID, conversationID, text, mode string) (*Reply, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, ErrEmpty
	}
	if len([]rune(text)) > s.cfg.MaxInputChars {
		return nil, ErrTooLong
	}
	if mode != ModeSearch {
		mode = ModeChat
	}
	model := s.cfg.ChatModel
	if mode == ModeSearch {
		model = s.cfg.SearchModel
	}

	// Cost saver: identical first questions in a new chat reuse a cached answer.
	cacheKey := ""
	if s.cfg.CacheEnabled && mode == ModeChat && conversationID == "" {
		cacheKey = s.cacheKey(model, text)
	}

	t0 := time.Now()
	st, err := s.store.LoadChat(ctx, userID, conversationID, cacheKey, s.cfg.CacheTTL)
	if err != nil {
		return nil, err
	}
	tLoad := time.Since(t0)

	quota := s.quota(st.Plan, st.RequestsToday, st.SearchesToday)
	if quota.Limit > 0 && quota.Used >= quota.Limit {
		return nil, &LimitError{Kind: "messages", Plan: quota.Plan}
	}
	if mode == ModeSearch && quota.SearchLimit > 0 && quota.Searches >= quota.SearchLimit {
		return nil, &LimitError{Kind: "searches", Plan: quota.Plan}
	}

	conv := st.Conversation
	if conv == nil {
		conv = &db.Conversation{Title: titleFrom(text)}
	}
	usage := db.Usage{Requests: 1}
	if mode == ModeSearch {
		usage.Searches = 1
	}
	meta := map[string]any{"model": model, "mode": mode}

	content := st.CachedResponse
	t1 := time.Now()
	if content != "" {
		meta["cached"] = true
		usage.CacheHits = 1
	} else {
		res, err := s.oa.Chat(ctx, openai.ChatRequest{
			Model:               model,
			Messages:            s.buildPrompt(conv, st.History, text),
			MaxCompletionTokens: s.cfg.MaxOutputTokens,
			ReasoningEffort:     s.cfg.ReasoningEffort,
			PromptCacheKey:      "mayelai-chat",
			WebSearchOptions:    searchOptions(mode),
		})
		if err != nil {
			return nil, err
		}
		usage.PromptTokens = res.Usage.PromptTokens
		usage.CachedTokens = res.Usage.PromptTokensDetails.CachedTokens
		usage.CompletionTokens = res.Usage.CompletionTokens
		meta["promptTokens"] = usage.PromptTokens
		meta["cachedTokens"] = usage.CachedTokens
		meta["completionTokens"] = usage.CompletionTokens
		if res.FinishReason == "length" {
			meta["truncated"] = true
		}
		content = strings.TrimSpace(res.Content)
		if content == "" {
			// Still count the tokens we paid for.
			if err := s.store.RecordUsage(ctx, userID, usage); err != nil {
				log.Printf("record usage: %v", err)
			}
			return nil, ErrNoReply
		}
	}
	tLLM := time.Since(t1)

	suggest := mode == ModeChat && suggestsSearch(content)
	cacheResponse := ""
	if cacheKey != "" && usage.CacheHits == 0 && !suggest && meta["truncated"] == nil {
		cacheResponse = content
	}

	userMsg := db.Message{Role: "user", Content: text}
	if mode == ModeSearch {
		userMsg.Metadata = map[string]any{"mode": mode}
	}
	t2 := time.Now()
	saved, userMsg, asstMsg, err := s.store.SaveChat(ctx, userID, conversationID, conv.Title,
		userMsg, db.Message{Role: "assistant", Content: content, Metadata: meta},
		usage, cacheKey, cacheResponse)
	if err != nil {
		return nil, err
	}
	tSave := time.Since(t2)
	conv.ID, conv.Title, conv.CreatedAt, conv.UpdatedAt = saved.ID, saved.Title, saved.CreatedAt, saved.UpdatedAt
	quota.Used++
	quota.Searches += usage.Searches

	log.Printf("chat: mode=%s model=%s cached=%v db_load=%s llm=%s db_save=%s tokens=%d/%d",
		mode, model, usage.CacheHits > 0, tLoad.Round(time.Millisecond), tLLM.Round(time.Millisecond),
		tSave.Round(time.Millisecond), usage.PromptTokens, usage.CompletionTokens)

	s.maybeSummarize(userID, conv, append(st.History, userMsg, asstMsg))

	return &Reply{
		Conversation:     *conv,
		UserMessage:      userMsg,
		AssistantMessage: asstMsg,
		SearchSuggestion: suggest,
		Quota:            quota,
	}, nil
}

// buildPrompt assembles: stable system prompt (first, so OpenAI's prompt
// caching discount applies), the rolling summary of older messages, the
// recent unsummarized messages, then the new user message.
func (s *Service) buildPrompt(conv *db.Conversation, history []db.Message, text string) []openai.Message {
	system := s.cfg.SystemPrompt
	if conv.Summary != "" {
		// Appended after the fixed prompt so the cached prefix is unchanged.
		system += "\n\nEarlier in this conversation (older messages were summarized; " +
			"treat these as things the user already told you or you already answered):\n" + conv.Summary
	}
	msgs := []openai.Message{{Role: "system", Content: system}}
	// Hard cap in case summarization is lagging behind.
	if max := s.cfg.HistoryMessages + s.cfg.SummaryBatch; len(history) > max {
		history = history[len(history)-max:]
	}
	for _, m := range history {
		msgs = append(msgs, openai.Message{Role: m.Role, Content: m.Content})
	}
	return append(msgs, openai.Message{Role: "user", Content: text})
}

// maybeSummarize folds older messages into the conversation's rolling summary
// once more than HistoryMessages+SummaryBatch messages are unsummarized, so
// prompts stay small no matter how long a conversation gets. It runs in the
// background after the reply has been sent.
func (s *Service) maybeSummarize(userID string, conv *db.Conversation, unsummarized []db.Message) {
	keep := s.cfg.HistoryMessages
	if len(unsummarized) <= keep+s.cfg.SummaryBatch {
		return
	}
	if _, busy := s.summarizing.LoadOrStore(conv.ID, struct{}{}); busy {
		return
	}
	fold := unsummarized[:len(unsummarized)-keep]
	prevSummary, prevCount := conv.Summary, conv.SummaryCount

	s.bg.Add(1)
	go func() {
		defer s.bg.Done()
		defer s.summarizing.Delete(conv.ID)
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()

		var b strings.Builder
		if prevSummary != "" {
			fmt.Fprintf(&b, "Existing summary:\n%s\n\n", prevSummary)
		}
		b.WriteString("New messages:\n")
		for _, m := range fold {
			who := "User"
			if m.Role == "assistant" {
				who = "Assistant"
			}
			fmt.Fprintf(&b, "%s: %s\n", who, truncate(m.Content, 2000))
		}

		res, err := s.oa.Chat(ctx, openai.ChatRequest{
			Model: s.cfg.SummaryModel,
			Messages: []openai.Message{
				{Role: "system", Content: "You maintain a compact running summary of a conversation between a user and an AI assistant. " +
					"Merge the existing summary with the new messages. Always keep personal details the user shared " +
					"(name, location, preferences), their goals, decisions, important answers and open questions. Write in the conversation's language. At most 150 words. Output only the summary."},
				{Role: "user", Content: b.String()},
			},
			MaxCompletionTokens: 600,
			ReasoningEffort:     s.cfg.ReasoningEffort,
			PromptCacheKey:      "mayelai-summary",
		})
		if err != nil {
			log.Printf("summarize %s: %v", conv.ID, err)
			return
		}
		_ = s.store.RecordUsage(ctx, userID, db.Usage{
			PromptTokens:     res.Usage.PromptTokens,
			CachedTokens:     res.Usage.PromptTokensDetails.CachedTokens,
			CompletionTokens: res.Usage.CompletionTokens,
		})
		summary := strings.TrimSpace(res.Content)
		if summary == "" {
			return
		}
		if err := s.store.UpdateSummary(ctx, conv.ID, summary, prevCount, prevCount+len(fold)); err != nil {
			log.Printf("save summary %s: %v", conv.ID, err)
		}
	}()
}

// cacheKey identifies a question independent of case, spacing and trailing
// punctuation. The model and system prompt are part of the key so changing
// either invalidates old answers.
func (s *Service) cacheKey(model, text string) string {
	norm := strings.Join(strings.Fields(strings.ToLower(text)), " ")
	norm = strings.TrimRightFunc(norm, func(r rune) bool { return unicode.IsPunct(r) || unicode.IsSpace(r) })
	sum := sha256.Sum256([]byte(model + "\x00" + s.cfg.SystemPrompt + "\x00" + norm))
	return hex.EncodeToString(sum[:])
}

func searchOptions(mode string) map[string]any {
	if mode != ModeSearch {
		return nil
	}
	// "low" context = fewer search tokens = cheaper.
	return map[string]any{"search_context_size": "low"}
}

var noAnswerPhrases = []string{
	"i'm sorry", "i couldn't find", "i don't know", "i am not sure", "i apologize",
	"i'm not sure", "i'm not familiar", "i am not able", "i don't have access",
	"i don't have real-time", "as of my knowledge cutoff",
	"je ne sais pas", "je ne suis pas sûr", "désolé", "je n'ai pas accès",
}

func suggestsSearch(reply string) bool {
	r := strings.ToLower(strings.ReplaceAll(reply, "’", "'"))
	for _, p := range noAnswerPhrases {
		if strings.Contains(r, p) {
			return true
		}
	}
	return false
}

func titleFrom(text string) string {
	t := strings.Join(strings.Fields(text), " ")
	return truncate(t, 60)
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}
