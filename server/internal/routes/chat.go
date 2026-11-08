package routes

import (
	"log"
	"strings"

	"github.com/gofiber/fiber/v3"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/openai"
)

var noAnswerPhrases = []string{
	"I'm sorry",
	"I couldn't find an answer",
	"I don't know",
	"I am not sure",
	"I apologize",
	"I'm not sure",
	"I'm not familiar",
	"I couldn't find",
	"I am not able",
}

// Chat handles POST /api/chat (requires a signed-in Clerk user).
func Chat(oa *openai.Client) fiber.Handler {
	return func(c fiber.Ctx) error {
		if auth.UserID(c) == "" {
			return c.Status(fiber.StatusUnauthorized).SendString("Unauthorized")
		}
		if oa.APIKey == "" {
			return c.Status(fiber.StatusInternalServerError).SendString("OpenAI API key missing")
		}

		var body struct {
			Messages []openai.Message `json:"messages"`
		}
		if err := c.Bind().JSON(&body); err != nil || body.Messages == nil {
			return c.Status(fiber.StatusBadRequest).SendString("Messages array is required")
		}

		reply, err := oa.Chat(c.Context(), openai.ChatRequest{
			Model:    "gpt-3.5-turbo",
			Messages: body.Messages,
		})
		if err != nil {
			log.Printf("[CHAT_API_ERROR] %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}

		suggestSearch := false
		for _, p := range noAnswerPhrases {
			if strings.Contains(reply, p) {
				suggestSearch = true
				break
			}
		}
		log.Printf("🚀 AI Response: %s", reply)
		log.Printf("🔍 Suggest Search? %v", suggestSearch)

		return c.JSON(fiber.Map{"message": reply, "searchSuggestion": suggestSearch})
	}
}
