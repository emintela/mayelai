package routes

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/gofiber/fiber/v3"
)

var serpClient = &http.Client{Timeout: 30 * time.Second}

// WebSearch handles POST /api/web-search via SerpAPI (Google engine) and
// returns the first organic result's snippet.
func WebSearch(apiKey string) fiber.Handler {
	return func(c fiber.Ctx) error {
		var body struct {
			Query string `json:"query"`
		}
		_ = c.Bind().JSON(&body)
		if body.Query == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Search query is required")
		}
		log.Printf("🔍 Performing Real Web Search for: %s", body.Query)

		snippet, err := serpFirstSnippet(c, apiKey, body.Query)
		if err != nil {
			log.Printf("[WEB_SEARCH_ERROR] %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}
		if snippet == "" {
			snippet = "No relevant results found."
		}
		return c.JSON(fiber.Map{"result": snippet})
	}
}

func serpFirstSnippet(c fiber.Ctx, apiKey, query string) (string, error) {
	params := url.Values{
		"engine":   {"google"},
		"q":        {query},
		"location": {"United States"},
		"hl":       {"en"},
		"gl":       {"us"},
		"api_key":  {apiKey},
	}
	req, err := http.NewRequestWithContext(c.Context(), http.MethodGet,
		"https://serpapi.com/search.json?"+params.Encode(), nil)
	if err != nil {
		return "", err
	}
	resp, err := serpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var out struct {
		Error          string `json:"error"`
		OrganicResults []struct {
			Snippet string `json:"snippet"`
		} `json:"organic_results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if resp.StatusCode >= 300 || out.Error != "" {
		return "", fmt.Errorf("serpapi: %s: %s", resp.Status, out.Error)
	}
	log.Printf("✅ Real Web Search Results: %d organic results", len(out.OrganicResults))
	if len(out.OrganicResults) == 0 {
		return "", nil
	}
	return out.OrganicResults[0].Snippet, nil
}
