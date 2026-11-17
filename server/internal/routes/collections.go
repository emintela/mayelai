package routes

import (
	"errors"
	"log"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/limiter"
	"github.com/google/uuid"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/money"
)

// Collections (family events).
//
//	GET    /api/money/collections
//	POST   /api/money/collections                          free plan: 1 open collection
//	GET    /api/money/collections/:id                      includes contributions (with phones)
//	PATCH  /api/money/collections/:id
//	DELETE /api/money/collections/:id
//	POST   /api/money/collections/:id/status               {status: open|closed}
//	POST   /api/money/collections/:id/link                 new share link
//	POST   /api/money/collections/:id/contributions        organizer adds one (e.g. cash)
//	POST   /api/money/collections/:id/contributions/:cid/status   {status: pledged|sent|received}
//	DELETE /api/money/collections/:id/contributions/:cid
//	POST   /api/money/collections/:id/contributions/:cid/reminded
//	POST   /api/money/collections/:id/draft                AI: {purpose: reminder|update, language, contribution_id?}
//
// Public: GET /api/public/collections/:token, POST /api/public/collections/:token/pledge
func registerCollections(m fiber.Router, d Deps, aiLimiter fiber.Handler) {
	m.Get("/collections", func(c fiber.Ctx) error {
		list, err := d.Money.ListCollections(c.Context(), auth.UserID(c))
		if err != nil {
			return internal(c, err)
		}
		p, _, err := plan(c, d)
		if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"collections": list, "plan": p, "open_limit": d.Config.OpenCollectionsFor(p)})
	})
	m.Post("/collections", func(c fiber.Ctx) error {
		var body struct {
			money.NewCollection
			Today string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		p, _, err := plan(c, d)
		if err != nil {
			return internal(c, err)
		}
		col, err := d.Money.CreateCollection(c.Context(), auth.UserID(c), body.NewCollection, clientToday(body.Today), d.Config.OpenCollectionsFor(p))
		if err != nil {
			return moneyError(c, err)
		}
		return c.Status(fiber.StatusCreated).JSON(col)
	})
	m.Get("/collections/:id", func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		return reply(c)(d.Money.GetCollection(c.Context(), auth.UserID(c), id))
	})
	m.Patch("/collections/:id", func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		var body struct {
			money.CollectionPatch
			Today string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		return reply(c)(d.Money.UpdateCollection(c.Context(), auth.UserID(c), id, body.CollectionPatch, clientToday(body.Today)))
	})
	m.Delete("/collections/:id", func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		if err := d.Money.DeleteCollection(c.Context(), auth.UserID(c), id); err != nil {
			return moneyError(c, err)
		}
		return c.SendStatus(fiber.StatusNoContent)
	})
	m.Post("/collections/:id/status", func(c fiber.Ctx) error {
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
		return reply(c)(d.Money.SetCollectionStatus(c.Context(), auth.UserID(c), id, body.Status, d.Config.OpenCollectionsFor(p)))
	})
	m.Post("/collections/:id/link", func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		return reply(c)(d.Money.RotateCollectionLink(c.Context(), auth.UserID(c), id))
	})
	m.Post("/collections/:id/contributions", func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		var body money.NewContribution
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		return reply(c)(d.Money.AddContribution(c.Context(), auth.UserID(c), id, body))
	})
	m.Post("/collections/:id/contributions/:cid/status", func(c fiber.Ctx) error {
		id, cid, err := twoIDs(c)
		if err != nil {
			return moneyError(c, err)
		}
		var body struct {
			Status string `json:"status"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		return reply(c)(d.Money.SetContributionStatus(c.Context(), auth.UserID(c), id, cid, body.Status))
	})
	m.Delete("/collections/:id/contributions/:cid", func(c fiber.Ctx) error {
		id, cid, err := twoIDs(c)
		if err != nil {
			return moneyError(c, err)
		}
		return reply(c)(d.Money.DeleteContribution(c.Context(), auth.UserID(c), id, cid))
	})
	m.Post("/collections/:id/contributions/:cid/reminded", func(c fiber.Ctx) error {
		id, cid, err := twoIDs(c)
		if err != nil {
			return moneyError(c, err)
		}
		return reply(c)(d.Money.MarkReminded(c.Context(), auth.UserID(c), id, cid))
	})
	m.Post("/collections/:id/draft", aiLimiter, collectionDraft(d))
}

func registerPublicCollections(app *fiber.App, d Deps) {
	limit := func(max int) fiber.Handler {
		return limiter.New(limiter.Config{
			Max:        max,
			Expiration: time.Minute,
			LimitReached: func(c fiber.Ctx) error {
				return jsonError(c, fiber.StatusTooManyRequests, "Too many requests. Please wait a moment.")
			},
		})
	}
	app.Get("/api/public/collections/:token", limit(60), func(c fiber.Ctx) error {
		col, err := d.Money.PublicCollectionByToken(c.Context(), c.Params("token"))
		if err != nil {
			return moneyError(c, err)
		}
		c.Set(fiber.HeaderCacheControl, "no-store")
		return c.JSON(col)
	})
	// Pledging is stricter: a few per minute per IP.
	app.Post("/api/public/collections/:token/pledge", limit(5), func(c fiber.Ctx) error {
		var body money.NewContribution
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		col, err := d.Money.Pledge(c.Context(), c.Params("token"), body)
		if err != nil {
			return moneyError(c, err)
		}
		return c.Status(fiber.StatusCreated).JSON(col)
	})
}

// reply writes a collection or maps the error.
func reply(c fiber.Ctx) func(*money.Collection, error) error {
	return func(col *money.Collection, err error) error {
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(col)
	}
}

func twoIDs(c fiber.Ctx) (id, cid uuid.UUID, err error) {
	a, err := loanID(c, "id")
	if err != nil {
		return id, cid, err
	}
	b, err := loanID(c, "cid")
	return a, b, err
}

func collectionDraft(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		var body struct {
			Purpose        string `json:"purpose"`
			Language       string `json:"language"`
			ContributionID string `json:"contribution_id"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		if !money.ReminderLanguages[body.Language] {
			return jsonError(c, fiber.StatusBadRequest, "Messages are available in English and French. Lingala is coming soon.")
		}
		col, err := d.Money.GetCollection(c.Context(), auth.UserID(c), id)
		if err != nil {
			return moneyError(c, err)
		}
		in := money.CollectionInput{
			Purpose: body.Purpose, Language: body.Language, Kind: col.Kind, Title: col.Title,
			Beneficiary: col.Beneficiary, Organizer: col.OwnerName, Closed: col.Status == "closed",
		}
		if col.Deadline != nil {
			in.Deadline = col.Deadline.Format("2006-01-02")
		}
		switch body.Purpose {
		case "reminder":
			if col.Status != "open" {
				return jsonError(c, fiber.StatusConflict, "This collection is closed.")
			}
			var who *money.Contribution
			for i := range col.Contributions {
				if col.Contributions[i].ID.String() == body.ContributionID {
					who = &col.Contributions[i]
				}
			}
			if who == nil {
				return moneyError(c, money.ErrNotFound)
			}
			if who.Status != "pledged" {
				return jsonError(c, fiber.StatusConflict, "Reminders are for promises that haven't been sent yet.")
			}
			in.Person, in.Pledged = who.Name, money.FormatAmount(who.AmountCents, col.Currency)
		case "update":
			in.Received = money.FormatAmount(col.Totals.ReceivedCents, col.Currency)
			in.PledgedTotal = money.FormatAmount(col.Totals.PledgedCents, col.Currency)
			in.Givers = col.Totals.Count
			if col.GoalCents != nil {
				in.Goal = money.FormatAmount(*col.GoalCents, col.Currency)
			}
		default:
			return jsonError(c, fiber.StatusBadRequest, "purpose must be reminder or update.")
		}
		if ok, err := aiAllowed(c, d); !ok {
			return err
		}
		msg, u, err := d.MoneyAI.CollectionDraft(c.Context(), in)
		recordAI(c.Context(), d, auth.UserID(c), u)
		if err != nil {
			if !errors.Is(err, money.ErrAIUnusable) {
				log.Printf("money: collection draft: %v", err)
				return jsonError(c, fiber.StatusBadGateway, "The assistant is unavailable. You can write the message yourself.")
			}
			return moneyError(c, err)
		}
		return c.JSON(fiber.Map{"message": msg})
	}
}
