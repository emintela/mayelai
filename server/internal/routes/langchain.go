package routes

import (
	"log"

	"github.com/gofiber/fiber/v3"

	"mayelai/server/internal/openai"
)

// LangchainSearch handles POST /api/langchain-search.
//
// The original Express route ran a LangChain OpenAI-tools agent with the
// "hwchase17/openai-tools-agent" prompt and an empty tool list, which reduces
// to a single chat completion: a system prompt, the chat history, then the
// user's input. This reproduces that directly and keeps the response shape
// ({ result: { input, chat_history, output } }).
func LangchainSearch(oa *openai.Client) fiber.Handler {
	return func(c fiber.Ctx) error {
		var body struct {
			Query       string           `json:"query"`
			ChatHistory []openai.Message `json:"chat_history"`
		}
		_ = c.Bind().JSON(&body)
		if body.Query == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Search query is required")
		}
		if oa.APIKey == "" {
			return c.Status(fiber.StatusInternalServerError).SendString("OPENAI_API_KEY is missing")
		}
		if body.ChatHistory == nil {
			body.ChatHistory = []openai.Message{}
		}

		msgs := []openai.Message{{Role: "system", Content: "You are a helpful assistant"}}
		for _, m := range body.ChatHistory {
			role := "assistant"
			if m.Role == "user" {
				role = "user"
			}
			msgs = append(msgs, openai.Message{Role: role, Content: m.Content})
		}
		msgs = append(msgs, openai.Message{Role: "user", Content: body.Query})

		temp := 0.0
		output, err := oa.Chat(c.Context(), openai.ChatRequest{
			Model:       "gpt-3.5-turbo-1106",
			Temperature: &temp,
			Messages:    msgs,
		})
		if err != nil {
			log.Printf("[LANGCHAIN_OPENAI_SEARCH_ERROR] %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}
		log.Printf("🔍 LangChain OpenAI Search Result: %s", output)

		return c.JSON(fiber.Map{"result": fiber.Map{
			"input":        body.Query,
			"chat_history": body.ChatHistory,
			"output":       output,
		}})
	}
}
