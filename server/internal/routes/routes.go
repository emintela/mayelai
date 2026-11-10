// Package routes defines the HTTP API.
package routes

import (
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/limiter"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/billing"
	"mayelai/server/internal/chat"
	"mayelai/server/internal/config"
	"mayelai/server/internal/db"
	"mayelai/server/internal/openai"
)

// Deps are the services the routes use. Billing is nil when Stripe isn't configured.
type Deps struct {
	Chat      *chat.Service
	Store     *db.Store
	Billing   *billing.Stripe
	Config    config.Config
	PerMinute int
}

// Register mounts all /api routes (every one requires a signed-in Clerk user)
// and the Stripe webhook.
func Register(app *fiber.App, d Deps) {
	svc, store, perMinute := d.Chat, d.Store, d.PerMinute

	// Stripe calls this directly: no Clerk auth, verified by signature instead.
	app.Post("/webhooks/stripe", stripeWebhook(d.Billing))

	api := app.Group("/api", auth.Require())

	// Per-user burst limit on the endpoint that costs money.
	chatLimiter := limiter.New(limiter.Config{
		Max:          perMinute,
		Expiration:   time.Minute,
		KeyGenerator: func(c fiber.Ctx) string { return auth.UserID(c) },
		LimitReached: func(c fiber.Ctx) error {
			return jsonError(c, fiber.StatusTooManyRequests, "You're sending messages too fast. Please wait a moment.")
		},
	})

	api.Post("/chat", chatLimiter, sendMessage(svc))
	api.Get("/usage", getUsage(svc))
	api.Get("/conversations", listConversations(store))
	api.Get("/conversations/:id", getConversation(store))
	api.Delete("/conversations/:id", deleteConversation(store))
	api.Delete("/conversations", deleteAllConversations(store))
	api.Put("/messages/:id/feedback", setFeedback(store))
	api.Get("/billing", getBilling(d))
	api.Post("/billing/checkout", startCheckout(d.Billing))
	api.Post("/billing/portal", openPortal(d.Billing))

	api.Use(func(c fiber.Ctx) error {
		return jsonError(c, fiber.StatusNotFound, "Not found")
	})
}

// POST /api/chat  { conversationId?, message, mode?: "chat" | "search", attachments?: [{name, type, data}] }
func sendMessage(svc *chat.Service) fiber.Handler {
	return func(c fiber.Ctx) error {
		var body struct {
			ConversationID string            `json:"conversationId"`
			Message        string            `json:"message"`
			Mode           string            `json:"mode"`
			Attachments    []chat.Attachment `json:"attachments"`
		}
		if err := c.Bind().JSON(&body); err != nil {
			return jsonError(c, fiber.StatusBadRequest, "Invalid JSON body")
		}
		reply, err := svc.Send(c.Context(), auth.UserID(c), body.ConversationID, body.Message, body.Mode, body.Attachments)
		var limitErr *chat.LimitError
		var attachErr *chat.AttachmentError
		switch {
		case err == nil:
			return c.JSON(reply)
		case errors.As(err, &attachErr):
			return jsonError(c, fiber.StatusBadRequest, attachErr.Msg)
		case errors.Is(err, chat.ErrEmpty):
			return jsonError(c, fiber.StatusBadRequest, "Message is required")
		case errors.Is(err, chat.ErrTooLong):
			return jsonError(c, fiber.StatusRequestEntityTooLarge, "Message is too long")
		case errors.As(err, &limitErr):
			msg := "You've reached today's message limit."
			if limitErr.Kind == "searches" {
				msg = "You've reached today's AI search limit."
			}
			if limitErr.Plan == "free" {
				msg += " Upgrade to Pro for more, or come back after midnight UTC."
			} else {
				msg += " It resets at midnight UTC."
			}
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": msg, "code": "limit_" + limitErr.Kind, "upgrade": limitErr.Plan == "free",
			})
		case errors.Is(err, db.ErrNotFound):
			return jsonError(c, fiber.StatusNotFound, "Conversation not found")
		case errors.Is(err, openai.ErrPromptRejected):
			log.Printf("[CHAT_REJECTED] %v", err)
			return jsonError(c, fiber.StatusUnprocessableEntity, "Sorry, I couldn't process that message. Please try rephrasing it.")
		default:
			log.Printf("[CHAT_ERROR] %v", err)
			return jsonError(c, fiber.StatusInternalServerError, "Something went wrong. Please try again.")
		}
	}
}

// GET /api/usage
func getUsage(svc *chat.Service) fiber.Handler {
	return func(c fiber.Ctx) error {
		q, err := svc.Quota(c.Context(), auth.UserID(c))
		if err != nil {
			return internal(c, err)
		}
		return c.JSON(q)
	}
}

// GET /api/conversations?q=search+text&limit=50
func listConversations(store *db.Store) fiber.Handler {
	return func(c fiber.Ctx) error {
		limit, _ := strconv.Atoi(c.Query("limit"))
		if limit <= 0 || limit > 200 {
			limit = 50
		}
		q := strings.TrimSpace(c.Query("q"))
		if r := []rune(q); len(r) > 200 {
			q = string(r[:200])
		}
		convs, err := store.ListConversations(c.Context(), auth.UserID(c), q, limit)
		if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"conversations": convs})
	}
}

// GET /api/conversations/:id
func getConversation(store *db.Store) fiber.Handler {
	return func(c fiber.Ctx) error {
		conv, err := store.GetConversation(c.Context(), auth.UserID(c), c.Params("id"))
		if errors.Is(err, db.ErrNotFound) {
			return jsonError(c, fiber.StatusNotFound, "Conversation not found")
		} else if err != nil {
			return internal(c, err)
		}
		msgs, err := store.Messages(c.Context(), conv.ID, 0)
		if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"conversation": conv, "messages": msgs})
	}
}

// DELETE /api/conversations/:id
func deleteConversation(store *db.Store) fiber.Handler {
	return func(c fiber.Ctx) error {
		err := store.DeleteConversation(c.Context(), auth.UserID(c), c.Params("id"))
		if errors.Is(err, db.ErrNotFound) {
			return jsonError(c, fiber.StatusNotFound, "Conversation not found")
		} else if err != nil {
			return internal(c, err)
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

// DELETE /api/conversations — clears all of the user's history.
func deleteAllConversations(store *db.Store) fiber.Handler {
	return func(c fiber.Ctx) error {
		n, err := store.DeleteAllConversations(c.Context(), auth.UserID(c))
		if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"deleted": n})
	}
}

// PUT /api/messages/:id/feedback  { value: 1 | -1 | 0 }
func setFeedback(store *db.Store) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := strconv.ParseInt(c.Params("id"), 10, 64)
		if err != nil {
			return jsonError(c, fiber.StatusNotFound, "Message not found")
		}
		var body struct {
			Value int `json:"value"`
		}
		if err := c.Bind().JSON(&body); err != nil || body.Value < -1 || body.Value > 1 {
			return jsonError(c, fiber.StatusBadRequest, "value must be 1, -1 or 0")
		}
		err = store.SetFeedback(c.Context(), auth.UserID(c), id, body.Value)
		if errors.Is(err, db.ErrNotFound) {
			return jsonError(c, fiber.StatusNotFound, "Message not found")
		} else if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"feedback": body.Value})
	}
}

// GET /api/billing — the user's plan, today's usage, plan limits and the Pro price.
func getBilling(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx, userID := c.Context(), auth.UserID(c)
		sub, err := d.Store.GetSubscription(ctx, userID)
		if err != nil {
			return internal(c, err)
		}
		quota, err := d.Chat.Quota(ctx, userID)
		if err != nil {
			return internal(c, err)
		}
		out := fiber.Map{
			"enabled":      d.Billing != nil,
			"subscription": sub,
			"quota":        quota,
			"limits":       fiber.Map{"free": d.Config.Free, "pro": d.Config.Pro},
		}
		if d.Billing != nil {
			if price, err := d.Billing.ProPrice(ctx); err == nil {
				out["price"] = price
			} else {
				log.Printf("billing: fetch price: %v", err)
			}
		}
		return c.JSON(out)
	}
}

// POST /api/billing/checkout — returns { url } of a Stripe Checkout page.
func startCheckout(b *billing.Stripe) fiber.Handler {
	return func(c fiber.Ctx) error {
		if b == nil {
			return jsonError(c, fiber.StatusServiceUnavailable, "Payments aren't available yet.")
		}
		url, err := b.Checkout(c.Context(), auth.UserID(c))
		if errors.Is(err, billing.ErrAlreadySubscribed) {
			return jsonError(c, fiber.StatusConflict, "You're already on Pro.")
		} else if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"url": url})
	}
}

// POST /api/billing/portal — returns { url } of Stripe's Customer Portal.
func openPortal(b *billing.Stripe) fiber.Handler {
	return func(c fiber.Ctx) error {
		if b == nil {
			return jsonError(c, fiber.StatusServiceUnavailable, "Payments aren't available yet.")
		}
		url, err := b.Portal(c.Context(), auth.UserID(c))
		if errors.Is(err, billing.ErrNoCustomer) {
			return jsonError(c, fiber.StatusBadRequest, "You don't have a subscription yet.")
		} else if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"url": url})
	}
}

// POST /webhooks/stripe
func stripeWebhook(b *billing.Stripe) fiber.Handler {
	return func(c fiber.Ctx) error {
		if b == nil {
			return c.SendStatus(fiber.StatusNotFound)
		}
		err := b.HandleWebhook(c.Context(), c.Body(), c.Get("Stripe-Signature"))
		switch {
		case err == nil:
			return c.SendStatus(fiber.StatusOK)
		case errors.Is(err, billing.ErrBadSignature):
			log.Printf("billing: %v", err)
			return c.SendStatus(fiber.StatusBadRequest)
		default:
			// 500 makes Stripe retry later.
			log.Printf("billing: webhook: %v", err)
			return c.SendStatus(fiber.StatusInternalServerError)
		}
	}
}

func jsonError(c fiber.Ctx, status int, msg string) error {
	return c.Status(status).JSON(fiber.Map{"error": msg})
}

func internal(c fiber.Ctx, err error) error {
	log.Printf("[API_ERROR] %s %s: %v", c.Method(), c.Path(), err)
	return jsonError(c, fiber.StatusInternalServerError, "Internal Server Error")
}
