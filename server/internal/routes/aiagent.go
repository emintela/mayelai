package routes

import (
	"log"

	"github.com/gofiber/fiber/v3"

	"mayelai/server/internal/openai"
)

// AIAgent handles POST /api/ai-agent using OpenAI's search-enabled model.
func AIAgent(oa *openai.Client) fiber.Handler {
	return func(c fiber.Ctx) error {
		var body struct {
			Query string `json:"query"`
		}
		_ = c.Bind().JSON(&body)
		log.Printf("🤖 AI Agent Processing: %s", body.Query)

		reply, err := oa.Chat(c.Context(), openai.ChatRequest{
			Model:            "gpt-4o-search-preview",
			WebSearchOptions: map[string]any{"search_context_size": "medium"},
			Messages:         []openai.Message{{Role: "user", Content: body.Query}},
		})
		if err != nil {
			log.Printf("❌ AI Agent Error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Search failed"})
		}
		log.Printf("✅ AI Agent Result: %s", reply)
		return c.JSON(fiber.Map{"message": reply})
	}
}
