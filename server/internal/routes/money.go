package routes

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/limiter"
	"github.com/google/uuid"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/db"
	"mayelai/server/internal/money"
)

// Family money (stage A: IOU tracker).
//
//	GET    /api/money/loans?status=open|closed
//	POST   /api/money/loans                         create (free plan: limited open loans)
//	POST   /api/money/parse                         AI: sentence -> draft loan (not saved)
//	GET    /api/money/loans/:id
//	PATCH  /api/money/loans/:id
//	DELETE /api/money/loans/:id
//	POST   /api/money/loans/:id/payments            record a repayment
//	DELETE /api/money/loans/:id/payments/:pid
//	POST   /api/money/loans/:id/status              {status: open|paid|forgiven|cancelled}
//	POST   /api/money/loans/:id/link                new share link (old one stops working)
//	POST   /api/money/loans/:id/reminders/draft     AI: polite reminder text
//	POST   /api/money/loans/:id/reminders           log a reminder the user sent
//
// Public (no account): GET /api/public/loans/:token, POST /api/public/loans/:token/respond
func registerMoney(api fiber.Router, d Deps, aiLimiter fiber.Handler) {
	if d.Money == nil {
		return
	}
	m := api.Group("/money")
	m.Get("/loans", listLoans(d))
	m.Post("/loans", createLoan(d))
	m.Post("/parse", aiLimiter, parseLoan(d))
	m.Get("/loans/:id", getLoan(d))
	m.Patch("/loans/:id", updateLoan(d))
	m.Delete("/loans/:id", deleteLoan(d))
	m.Post("/loans/:id/payments", addPayment(d))
	m.Delete("/loans/:id/payments/:pid", deletePayment(d))
	m.Post("/loans/:id/status", setLoanStatus(d))
	m.Post("/loans/:id/link", rotateLink(d))
	m.Post("/loans/:id/reminders/draft", aiLimiter, draftReminder(d))
	m.Post("/loans/:id/reminders", logReminder(d))
	registerRequests(m, d)
	registerCollections(m, d, aiLimiter)
	registerGroups(m, d, aiLimiter)
	registerOnSave(api, d)
}

func registerPublicMoney(app *fiber.App, d Deps) {
	if d.Money == nil {
		return
	}
	ipLimit := limiter.New(limiter.Config{
		Max:        30,
		Expiration: time.Minute,
		LimitReached: func(c fiber.Ctx) error {
			return jsonError(c, fiber.StatusTooManyRequests, "Too many requests. Please wait a moment.")
		},
	})
	app.Get("/api/public/loans/:token", ipLimit, func(c fiber.Ctx) error {
		l, err := d.Money.ByToken(c.Context(), c.Params("token"))
		if err != nil {
			return moneyError(c, err)
		}
		c.Set(fiber.HeaderCacheControl, "no-store")
		return c.JSON(l)
	})
	app.Post("/api/public/loans/:token/respond", ipLimit, func(c fiber.Ctx) error {
		var body struct {
			Response string `json:"response"`
			Note     string `json:"note"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		l, err := d.Money.Respond(c.Context(), c.Params("token"), body.Response, body.Note)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(l)
	})
	registerPublicRequests(app, d, ipLimit)
	registerPublicCollections(app, d)
	registerPublicGroups(app, d)
}

// ---------- helpers ----------

func moneyError(c fiber.Ctx, err error) error {
	var ve *money.ValidationError
	var le *money.LimitError
	switch {
	case errors.As(err, &ve):
		return jsonError(c, fiber.StatusBadRequest, ve.Msg)
	case errors.Is(err, money.ErrNotFound):
		return jsonError(c, fiber.StatusNotFound, "Not found.")
	case errors.Is(err, money.ErrState):
		return jsonError(c, fiber.StatusConflict, "This can't be done in its current state.")
	case errors.Is(err, money.ErrRequestTaken):
		return jsonError(c, fiber.StatusConflict, "This request was already opened with another account.")
	case errors.Is(err, money.ErrAlreadyLinked):
		return jsonError(c, fiber.StatusConflict, "This personal link is already used by another account.")
	case errors.As(err, &le):
		msg := "You've reached the free plan's limit of open loans. Upgrade to Pro for unlimited loans, or close a loan first."
		if le.Kind == "groups" {
			msg = "The free plan allows one likelemba group at a time. Upgrade to Pro for unlimited groups."
		}
		if le.Kind == "collections" {
			msg = "The free plan allows one open collection at a time. Upgrade to Pro for unlimited collections, or close the current one first."
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": msg, "code": "limit_" + le.Kind, "upgrade": true})
	case errors.Is(err, money.ErrAIUnusable):
		return jsonError(c, fiber.StatusUnprocessableEntity, "The assistant couldn't understand that. Please fill in the form instead.")
	}
	return internal(c, err)
}

// decodeStrict rejects unknown fields so clients can't set fields they shouldn't.
func decodeStrict(c fiber.Ctx, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(c.Body()))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return &money.ValidationError{Msg: "Invalid request."}
	}
	return nil
}

func loanID(c fiber.Ctx, param string) (uuid.UUID, error) {
	id, err := uuid.Parse(c.Params(param))
	if err != nil {
		return uuid.Nil, money.ErrNotFound
	}
	return id, nil
}

// clientToday accepts the browser's local date (so "today" matches the user's
// timezone) when it is within a day of the server's UTC date.
func clientToday(raw string) time.Time {
	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if raw == "" {
		return today
	}
	t, err := time.Parse("2006-01-02", raw)
	if err != nil || t.Sub(today) > 26*time.Hour || today.Sub(t) > 26*time.Hour {
		return today
	}
	return t
}

func plan(c fiber.Ctx, d Deps) (string, int, error) {
	p, used, _, err := d.Store.UsageToday(c.Context(), auth.UserID(c))
	return p, used, err
}

// aiAllowed enforces the daily AI quota shared with chat; returns false after
// writing the response.
func aiAllowed(c fiber.Ctx, d Deps) (bool, error) {
	if d.MoneyAI == nil {
		return false, jsonError(c, fiber.StatusServiceUnavailable, "The assistant isn't available right now. Please fill in the form.")
	}
	p, used, err := plan(c, d)
	if err != nil {
		return false, internal(c, err)
	}
	if limit := d.Config.LimitsFor(p).Messages; limit > 0 && used >= limit {
		return false, c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"error":   "You've used today's AI requests. They reset at midnight UTC.",
			"code":    "limit_messages",
			"upgrade": p == "free",
		})
	}
	return true, nil
}

func recordAI(ctx context.Context, d Deps, userID string, u money.Usage) {
	if err := d.Store.RecordUsage(ctx, userID, db.Usage{
		Requests: 1, PromptTokens: u.PromptTokens, CachedTokens: u.CachedTokens, CompletionTokens: u.CompletionTokens,
	}); err != nil {
		log.Printf("money: record usage: %v", err)
	}
}

// ---------- handlers ----------

func listLoans(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		status := c.Query("status")
		if status != "" && status != "open" && status != "closed" {
			return jsonError(c, fiber.StatusBadRequest, "status must be open or closed.")
		}
		loans, err := d.Money.List(c.Context(), auth.UserID(c), status)
		if err != nil {
			return internal(c, err)
		}
		p, _, err := plan(c, d)
		if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"loans": loans, "plan": p, "open_limit": d.Config.OpenLoansFor(p)})
	}
}

func createLoan(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		var body struct {
			money.NewLoan
			Today string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		p, _, err := plan(c, d)
		if err != nil {
			return internal(c, err)
		}
		l, err := d.Money.Create(c.Context(), auth.UserID(c), body.NewLoan, clientToday(body.Today), d.Config.OpenLoansFor(p))
		if err != nil {
			return moneyError(c, err)
		}
		return c.Status(fiber.StatusCreated).JSON(l)
	}
}

func parseLoan(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		var body struct {
			Text  string `json:"text"`
			Today string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		text := strings.TrimSpace(body.Text)
		if text == "" || len([]rune(text)) > 300 {
			return jsonError(c, fiber.StatusBadRequest, "Write one sentence (up to 300 characters).")
		}
		if ok, err := aiAllowed(c, d); !ok {
			return err
		}
		draft, u, err := d.MoneyAI.ParseLoan(c.Context(), text, clientToday(body.Today))
		recordAI(c.Context(), d, auth.UserID(c), u)
		if err != nil {
			if !errors.Is(err, money.ErrAIUnusable) {
				log.Printf("money: parse: %v", err)
				return jsonError(c, fiber.StatusBadGateway, "The assistant is unavailable. Please fill in the form.")
			}
			return moneyError(c, err)
		}
		return c.JSON(draft)
	}
}

func getLoan(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		l, err := d.Money.Get(c.Context(), auth.UserID(c), id)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(l)
	}
}

func updateLoan(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		var p money.LoanPatch
		if err := decodeStrict(c, &p); err != nil {
			return moneyError(c, err)
		}
		l, err := d.Money.Update(c.Context(), auth.UserID(c), id, p)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(l)
	}
}

func deleteLoan(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		if err := d.Money.Delete(c.Context(), auth.UserID(c), id); err != nil {
			return moneyError(c, err)
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func addPayment(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		var body struct {
			money.NewPayment
			Today string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		l, err := d.Money.AddPayment(c.Context(), auth.UserID(c), id, body.NewPayment, clientToday(body.Today))
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(l)
	}
}

func deletePayment(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		pid, err := loanID(c, "pid")
		if err != nil {
			return moneyError(c, err)
		}
		l, err := d.Money.DeletePayment(c.Context(), auth.UserID(c), id, pid)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(l)
	}
}

func setLoanStatus(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		var body struct {
			Status string `json:"status"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		p, _, err := plan(c, d)
		if err != nil {
			return internal(c, err)
		}
		l, err := d.Money.SetStatus(c.Context(), auth.UserID(c), id, body.Status, d.Config.OpenLoansFor(p))
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(l)
	}
}

func rotateLink(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		l, err := d.Money.RotateLink(c.Context(), auth.UserID(c), id)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(l)
	}
}

func draftReminder(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		var body struct {
			Language string `json:"language"`
			Tone     string `json:"tone"`
			Today    string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		if !money.ReminderLanguages[body.Language] {
			return jsonError(c, fiber.StatusBadRequest, "Reminders are available in English and French. Lingala is coming soon.")
		}
		if body.Tone != "gentle" && body.Tone != "firm" {
			return jsonError(c, fiber.StatusBadRequest, "tone must be gentle or firm.")
		}
		l, err := d.Money.Get(c.Context(), auth.UserID(c), id)
		if err != nil {
			return moneyError(c, err)
		}
		if l.Status != "open" || l.Direction != "lent" {
			return jsonError(c, fiber.StatusConflict, "Reminders are for open loans you gave.")
		}
		if ok, err := aiAllowed(c, d); !ok {
			return err
		}
		in := money.ReminderInput{
			Language: body.Language, Tone: body.Tone, OwnerName: l.OwnerName, Borrower: l.CounterpartyName,
			Outstanding: money.FormatAmount(l.OutstandingCents, l.Currency),
			Original:    money.FormatAmount(l.AmountCents, l.Currency),
			LentOn:      l.LentOn.Format("2006-01-02"),
			Confirmed:   l.Response == "confirmed",
		}
		if l.DueOn != nil {
			in.DueOn = l.DueOn.Format("2006-01-02")
			in.DaysLate = int(clientToday(body.Today).Sub(l.DueOn.Time).Hours() / 24)
		}
		msg, u, err := d.MoneyAI.ReminderDraft(c.Context(), in)
		recordAI(c.Context(), d, auth.UserID(c), u)
		if err != nil {
			if !errors.Is(err, money.ErrAIUnusable) {
				log.Printf("money: reminder: %v", err)
				return jsonError(c, fiber.StatusBadGateway, "The assistant is unavailable. You can write the message yourself.")
			}
			return moneyError(c, err)
		}
		return c.JSON(fiber.Map{"message": msg})
	}
}

func logReminder(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		var body struct {
			Channel  string `json:"channel"`
			Language string `json:"language"`
			Message  string `json:"message"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		l, err := d.Money.LogReminder(c.Context(), auth.UserID(c), id, body.Channel, body.Language, body.Message)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(l)
	}
}
