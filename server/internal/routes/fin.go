package routes

import (
	"errors"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/limiter"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/fin"
)

// AI Fin: bank accounts through Plaid.
//
//	GET    /api/fin?today=               {enabled, overview}
//	POST   /api/fin/link-token           {item_id?, lang} → {link_token}
//	POST   /api/fin/connect              {public_token, institution: {id, name}, today} → overview
//	POST   /api/fin/refresh              {today} → overview
//	GET    /api/fin/transactions?account=&category=&q=&limit=&offset=
//	DELETE /api/fin/banks/:id
//	GET    /api/fin/budgets?month=YYYY-MM&today=    PUT /api/fin/budgets {category, amount_cents}
//	DELETE /api/fin/budgets/:category               POST /api/fin/budgets/suggest {cut: 0|10|20, today}
//	GET    /api/fin/tips?today=
func registerFin(api fiber.Router, d Deps) {
	f := api.Group("/fin")
	f.Get("/", func(c fiber.Ctx) error {
		if !d.Fin.Enabled() {
			return c.JSON(fiber.Map{"enabled": false})
		}
		o, err := d.Fin.Overview(c.Context(), auth.UserID(c), clientToday(c.Query("today")))
		if err != nil {
			return finError(c, err)
		}
		return c.JSON(fiber.Map{"enabled": true, "overview": o})
	})

	// Every call below reaches Plaid: a few per minute per person is plenty.
	plaidLimit := limiter.New(limiter.Config{
		Max:          12,
		Expiration:   time.Minute,
		KeyGenerator: func(c fiber.Ctx) string { return "fin:" + auth.UserID(c) },
		LimitReached: func(c fiber.Ctx) error {
			return jsonError(c, fiber.StatusTooManyRequests, "Too many tries. Please wait a minute.")
		},
	})
	on := func(c fiber.Ctx) error {
		if !d.Fin.Enabled() {
			return jsonError(c, fiber.StatusServiceUnavailable, "Bank connections aren't available yet.")
		}
		return c.Next()
	}

	f.Post("/link-token", on, plaidLimit, func(c fiber.Ctx) error {
		var body struct {
			ItemID string `json:"item_id"`
			Lang   string `json:"lang"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return finError(c, fin.ErrInvalid)
		}
		tok, err := d.Fin.LinkToken(c.Context(), auth.UserID(c), body.Lang, body.ItemID)
		if err != nil {
			return finError(c, err)
		}
		return c.JSON(fiber.Map{"link_token": tok})
	})
	f.Post("/connect", on, plaidLimit, func(c fiber.Ctx) error {
		var body struct {
			PublicToken string `json:"public_token"`
			Institution struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"institution"`
			Today string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return finError(c, fin.ErrInvalid)
		}
		user := auth.UserID(c)
		if err := d.Fin.Connect(c.Context(), user, body.PublicToken, body.Institution.ID, body.Institution.Name); err != nil {
			return finError(c, err)
		}
		o, err := d.Fin.Overview(c.Context(), user, clientToday(body.Today))
		if err != nil {
			return finError(c, err)
		}
		return c.Status(fiber.StatusCreated).JSON(o)
	})
	f.Post("/refresh", on, plaidLimit, func(c fiber.Ctx) error {
		var body struct {
			Today string `json:"today"`
		}
		_ = decodeStrict(c, &body)
		user := auth.UserID(c)
		if err := d.Fin.Refresh(c.Context(), user, time.Minute); err != nil {
			return finError(c, err)
		}
		o, err := d.Fin.Overview(c.Context(), user, clientToday(body.Today))
		if err != nil {
			return finError(c, err)
		}
		return c.JSON(o)
	})
	f.Get("/transactions", on, func(c fiber.Ctx) error {
		txns, err := d.Fin.Transactions(c.Context(), auth.UserID(c), fin.TxnQuery{
			AccountID: c.Query("account"),
			Category:  strings.ToUpper(c.Query("category")),
			Search:    c.Query("q"),
			Limit:     fiber.Query[int](c, "limit", 50),
			Offset:    fiber.Query[int](c, "offset", 0),
		})
		if err != nil {
			return finError(c, err)
		}
		return c.JSON(fiber.Map{"transactions": txns})
	})
	// Budgets and tips (no Plaid call).
	f.Get("/budgets", on, func(c fiber.Ctx) error {
		today := clientToday(c.Query("today"))
		v, err := d.Fin.Budgets(c.Context(), auth.UserID(c), fin.ParseMonth(c.Query("month"), today), today)
		if err != nil {
			return finError(c, err)
		}
		return c.JSON(v)
	})
	f.Put("/budgets", on, func(c fiber.Ctx) error {
		var body struct {
			Category    string `json:"category"`
			AmountCents int64  `json:"amount_cents"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return finError(c, fin.ErrInvalid)
		}
		if err := d.Fin.SetBudget(c.Context(), auth.UserID(c), body.Category, body.AmountCents); err != nil {
			return finError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	})
	f.Delete("/budgets/:category", on, func(c fiber.Ctx) error {
		if err := d.Fin.DeleteBudget(c.Context(), auth.UserID(c), c.Params("category")); err != nil {
			return finError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	})
	f.Post("/budgets/suggest", on, func(c fiber.Ctx) error {
		var body struct {
			Cut   int    `json:"cut"`
			Today string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return finError(c, fin.ErrInvalid)
		}
		n, err := d.Fin.ApplySuggestions(c.Context(), auth.UserID(c), clientToday(body.Today), body.Cut)
		if err != nil {
			return finError(c, err)
		}
		return c.JSON(fiber.Map{"created": n})
	})
	registerFinAlerts(f, d, on)
	f.Get("/tips", on, func(c fiber.Ctx) error {
		tips, err := d.Fin.Tips(c.Context(), auth.UserID(c), clientToday(c.Query("today")))
		if err != nil {
			return finError(c, err)
		}
		return c.JSON(tips)
	})
	f.Delete("/banks/:id", on, plaidLimit, func(c fiber.Ctx) error {
		if err := d.Fin.Disconnect(c.Context(), auth.UserID(c), c.Params("id")); err != nil {
			return finError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	})
}

func finError(c fiber.Ctx, err error) error {
	var pe *fin.PlaidError
	switch {
	case errors.Is(err, fin.ErrNotFound):
		return jsonError(c, fiber.StatusNotFound, "Not found.")
	case errors.Is(err, fin.ErrInvalid):
		msg := "Invalid request."
		if s := strings.TrimPrefix(err.Error(), fin.ErrInvalid.Error()+": "); s != err.Error() {
			msg = strings.ToUpper(s[:1]) + s[1:] + "."
		}
		return jsonError(c, fiber.StatusBadRequest, msg)
	case errors.As(err, &pe):
		log.Printf("[FIN] %v", pe)
		return jsonError(c, fiber.StatusBadGateway, "Your bank didn't answer. Please try again in a moment.")
	default:
		return internal(c, err)
	}
}
