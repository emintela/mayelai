package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/compress"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/gofiber/fiber/v3/middleware/static"
	"github.com/joho/godotenv"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/billing"
	"mayelai/server/internal/chat"
	"mayelai/server/internal/config"
	"mayelai/server/internal/db"
	"mayelai/server/internal/openai"
	"mayelai/server/internal/routes"
)

func main() {
	// Load server/.env if present; real environment variables take precedence.
	_ = godotenv.Load()
	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if cfg.ClerkSecretKey == "" {
		log.Fatal("CLERK_SECRET_KEY is not set")
	}
	clerk.SetKey(cfg.ClerkSecretKey)

	startCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	store, err := db.Open(startCtx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer store.Close()

	svc := chat.New(cfg, store, openai.New(cfg.OpenAIKey))
	go pruneCache(ctx, store, cfg.CacheTTL)

	app := fiber.New(fiber.Config{
		// Room for attachments: up to MAX_ATTACHMENTS files of MAX_ATTACHMENT_MB, base64-encoded (+33%).
		BodyLimit: cfg.MaxAttachments*cfg.MaxAttachmentBytes*4/3 + 256*1024,
	})
	app.Use(recover.New())
	app.Use(compress.New()) // gzip/brotli: smaller responses on slow mobile networks
	app.Use(cors.New())

	app.Get("/healthz", func(c fiber.Ctx) error {
		if err := store.Ping(c.Context()); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).SendString("db unavailable")
		}
		return c.SendString("ok")
	})

	app.Use("/api", auth.Clerk(cfg.AuthorizedOrigins))
	bill := billing.New(cfg, store)
	if bill == nil {
		log.Println("billing: Stripe not configured (set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID)")
	}
	routes.Register(app, routes.Deps{Chat: svc, Store: store, Billing: bill, Config: cfg, PerMinute: cfg.PerMinuteLimit})

	if cfg.StaticDir != "" {
		serveFrontend(app, cfg.StaticDir)
	}

	go func() {
		<-ctx.Done()
		log.Println("shutting down…")
		_ = app.ShutdownWithTimeout(20 * time.Second)
	}()

	log.Printf("Mayel AI server listening on http://localhost:%s (model %s)", cfg.Port, cfg.ChatModel)
	if err := app.Listen(":"+cfg.Port, fiber.ListenConfig{DisableStartupMessage: true}); err != nil {
		log.Printf("server: %v", err)
	}
	svc.Wait() // let background summaries finish
}

// serveFrontend serves the built React app from dir, falling back to
// index.html for client-side routes like /chat/123.
func serveFrontend(app *fiber.App, dir string) {
	index := filepath.Join(dir, "index.html")
	if _, err := os.Stat(index); err != nil {
		log.Printf("STATIC_DIR %q has no index.html; not serving the frontend", dir)
		return
	}
	sendIndex := func(c fiber.Ctx) error {
		c.Set(fiber.HeaderCacheControl, "no-cache")
		return c.Status(fiber.StatusOK).SendFile(index)
	}
	app.Get("/*", static.New(dir, static.Config{
		Compress:        true,
		NotFoundHandler: sendIndex,
		ModifyResponse: func(c fiber.Ctx) error {
			// Vite puts content-hashed files in /assets, so they can be cached forever.
			if strings.HasPrefix(c.Path(), "/assets/") {
				c.Set(fiber.HeaderCacheControl, "public, max-age=31536000, immutable")
			} else {
				c.Set(fiber.HeaderCacheControl, "no-cache")
			}
			return nil
		},
	}))
}

func pruneCache(ctx context.Context, store *db.Store, ttl time.Duration) {
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		if err := store.PruneCache(ctx, ttl); err != nil && ctx.Err() == nil {
			log.Printf("prune cache: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
