// Package openai is a minimal client for the OpenAI Chat Completions API.
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`

	// Cost controls.
	MaxCompletionTokens int    `json:"max_completion_tokens,omitempty"`
	ReasoningEffort     string `json:"reasoning_effort,omitempty"` // gpt-5 / o-series only
	// PromptCacheKey groups requests that share a prompt prefix so OpenAI's
	// automatic prompt caching (discounted input tokens) hits more often.
	PromptCacheKey string `json:"prompt_cache_key,omitempty"`

	Temperature      *float64       `json:"temperature,omitempty"`
	WebSearchOptions map[string]any `json:"web_search_options,omitempty"`
}

type Usage struct {
	PromptTokens        int `json:"prompt_tokens"`
	CompletionTokens    int `json:"completion_tokens"`
	PromptTokensDetails struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
}

type ChatResult struct {
	Content      string
	FinishReason string
	Model        string
	Usage        Usage
}

type chatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message      Message `json:"message"`
		FinishReason string  `json:"finish_reason"`
	} `json:"choices"`
	Usage Usage `json:"usage"`
}

// ErrPromptRejected means OpenAI's safety system refused the prompt. It
// occasionally flags harmless messages, so callers should ask the user to rephrase.
var ErrPromptRejected = errors.New("openai: prompt rejected by safety system")

type Client struct {
	APIKey string
	http   *http.Client
}

func New(apiKey string) *Client {
	return &Client{APIKey: apiKey, http: &http.Client{Timeout: 2 * time.Minute}}
}

// IsReasoningModel reports whether model accepts reasoning_effort. The
// search and chat-latest variants of gpt-5 reject it.
func IsReasoningModel(model string) bool {
	if strings.Contains(model, "search") || strings.Contains(model, "chat") {
		return false
	}
	return strings.HasPrefix(model, "gpt-5") ||
		strings.HasPrefix(model, "o1") || strings.HasPrefix(model, "o3") || strings.HasPrefix(model, "o4")
}

// Chat sends a chat completion request and returns the first choice.
func (c *Client) Chat(ctx context.Context, req ChatRequest) (*ChatResult, error) {
	if c.APIKey == "" {
		return nil, fmt.Errorf("OPENAI_API_KEY is not set")
	}
	if !IsReasoningModel(req.Model) {
		req.ReasoningEffort = ""
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.openai.com/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		var apiErr struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if json.Unmarshal(raw, &apiErr) == nil && apiErr.Error.Code == "invalid_prompt" {
			return nil, fmt.Errorf("%w: %s", ErrPromptRejected, raw)
		}
		return nil, fmt.Errorf("openai: %s: %s", resp.Status, raw)
	}
	var out chatResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	res := &ChatResult{Model: out.Model, Usage: out.Usage}
	if len(out.Choices) > 0 {
		res.Content = out.Choices[0].Message.Content
		res.FinishReason = out.Choices[0].FinishReason
	}
	return res, nil
}
