package main

import (
	"log"
	"os"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/joho/godotenv"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/openai"
	"mayelai/server/internal/routes"
)

func main() {
	// Load server/.env if present; real environment variables take precedence.
	_ = godotenv.Load()

	clerk.SetKey(os.Getenv("CLERK_SECRET_KEY"))

	oa := openai.New(os.Getenv("OPENAI_API_KEY"))

	app := fiber.New()
	app.Use(cors.New())
	app.Use(auth.Clerk())

	api := app.Group("/api")
	api.Post("/chat", routes.Chat(oa))
	api.Post("/ai-agent", routes.AIAgent(oa))
	api.Post("/langchain-search", routes.LangchainSearch(oa))
	api.Post("/web-search", routes.WebSearch(os.Getenv("SERPAPI_KEY")))

	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}
	log.Printf("Mayel AI server listening on http://localhost:%s", port)
	log.Fatal(app.Listen(":"+port, fiber.ListenConfig{DisableStartupMessage: true}))
}
