// Package openai is a minimal client for the OpenAI Chat Completions API.
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model            string         `json:"model"`
	Messages         []Message      `json:"messages"`
	Temperature      *float64       `json:"temperature,omitempty"`
	WebSearchOptions map[string]any `json:"web_search_options,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message Message `json:"message"`
	} `json:"choices"`
}

type Client struct {
	APIKey string
	http   *http.Client
}

func New(apiKey string) *Client {
	return &Client{APIKey: apiKey, http: &http.Client{Timeout: 2 * time.Minute}}
}

// Chat sends a chat completion request and returns the first choice's content.
func (c *Client) Chat(ctx context.Context, req ChatRequest) (string, error) {
	if c.APIKey == "" {
		return "", fmt.Errorf("OPENAI_API_KEY is not set")
	}
	body, err := json.Marshal(req)
	if err != nil {
		return "", err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.openai.com/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("openai: %s: %s", resp.Status, raw)
	}
	var out chatResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", err
	}
	if len(out.Choices) == 0 {
		return "", nil
	}
	return out.Choices[0].Message.Content, nil
}
