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

// Likelemba groups.
//
//	GET    /api/money/groups
//	POST   /api/money/groups                         free plan: 1 forming/active group
//	GET    /api/money/groups/:id                     members (phones, personal links) + rounds
//	PATCH  /api/money/groups/:id
//	DELETE /api/money/groups/:id
//	POST   /api/money/groups/:id/members             {name, phone}  (forming)
//	PATCH  /api/money/groups/:id/members/:mid        {name?, phone?}
//	DELETE /api/money/groups/:id/members/:mid        (forming)
//	POST   /api/money/groups/:id/order               {member_ids: [...]} (forming)
//	POST   /api/money/groups/:id/draw                random order (forming)
//	POST   /api/money/groups/:id/start               {start_date}
//	POST   /api/money/groups/:id/payments            {member_id, round, status: received|sent|none, method}
//	POST   /api/money/groups/:id/payouts             {round, paid}
//	POST   /api/money/groups/:id/cancel
//	POST   /api/money/groups/:id/link
//	POST   /api/money/groups/:id/draft               AI {purpose: reminder|update, language, member_id?}
//
// Public (no account; X-Member-Token identifies a member's own device):
//
//	GET  /api/public/groups/:token
//	POST /api/public/groups/:token/join              {name, phone}   (forming)
//	POST /api/public/groups/:token/paid              {round, method} (active; member token required)
func registerGroups(m fiber.Router, d Deps, aiLimiter fiber.Handler) {
	g := m.Group("/groups")
	g.Get("", func(c fiber.Ctx) error {
		list, err := d.Money.ListGroups(c.Context(), auth.UserID(c))
		if err != nil {
			return internal(c, err)
		}
		p, _, err := plan(c, d)
		if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"groups": list, "plan": p, "active_limit": d.Config.ActiveGroupsFor(p)})
	})
	g.Post("", func(c fiber.Ctx) error {
		var body money.NewGroup
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		p, _, err := plan(c, d)
		if err != nil {
			return internal(c, err)
		}
		grp, err := d.Money.CreateGroup(c.Context(), auth.UserID(c), body, d.Config.ActiveGroupsFor(p))
		if err != nil {
			return moneyError(c, err)
		}
		return c.Status(fiber.StatusCreated).JSON(grp)
	})
	withID := func(fn func(c fiber.Ctx, id uuid.UUID) (*money.Group, error)) fiber.Handler {
		return func(c fiber.Ctx) error {
			id, err := loanID(c, "id")
			if err != nil {
				return moneyError(c, err)
			}
			grp, err := fn(c, id)
			if err != nil {
				return moneyError(c, err)
			}
			return c.JSON(grp)
		}
	}
	g.Get("/:id", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		return d.Money.GetGroup(c.Context(), auth.UserID(c), id)
	}))
	g.Patch("/:id", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		var body money.GroupPatch
		if err := decodeStrict(c, &body); err != nil {
			return nil, err
		}
		return d.Money.UpdateGroup(c.Context(), auth.UserID(c), id, body)
	}))
	g.Delete("/:id", func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		if err := d.Money.DeleteGroup(c.Context(), auth.UserID(c), id); err != nil {
			return moneyError(c, err)
		}
		return c.SendStatus(fiber.StatusNoContent)
	})
	g.Post("/:id/members", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		var body struct {
			Name  string `json:"name"`
			Phone string `json:"phone"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return nil, err
		}
		return d.Money.AddMember(c.Context(), auth.UserID(c), id, body.Name, body.Phone)
	}))
	g.Patch("/:id/members/:mid", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		mid, err := loanID(c, "mid")
		if err != nil {
			return nil, err
		}
		var body struct {
			Name  *string `json:"name"`
			Phone *string `json:"phone"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return nil, err
		}
		return d.Money.UpdateMember(c.Context(), auth.UserID(c), id, mid, body.Name, body.Phone)
	}))
	g.Delete("/:id/members/:mid", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		mid, err := loanID(c, "mid")
		if err != nil {
			return nil, err
		}
		return d.Money.RemoveMember(c.Context(), auth.UserID(c), id, mid)
	}))
	g.Post("/:id/order", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		var body struct {
			MemberIDs []uuid.UUID `json:"member_ids"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return nil, err
		}
		return d.Money.SetOrder(c.Context(), auth.UserID(c), id, body.MemberIDs)
	}))
	g.Post("/:id/draw", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		return d.Money.DrawOrder(c.Context(), auth.UserID(c), id)
	}))
	g.Post("/:id/start", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		var body struct {
			StartDate string `json:"start_date"`
			Today     string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return nil, err
		}
		return d.Money.Start(c.Context(), auth.UserID(c), id, body.StartDate, clientToday(body.Today))
	}))
	g.Post("/:id/payments", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		var body struct {
			MemberID uuid.UUID `json:"member_id"`
			Round    int       `json:"round"`
			Status   string    `json:"status"`
			Method   string    `json:"method"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return nil, err
		}
		return d.Money.SetPayment(c.Context(), auth.UserID(c), id, body.MemberID, body.Round, body.Status, body.Method)
	}))
	g.Post("/:id/payouts", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		var body struct {
			Round int  `json:"round"`
			Paid  bool `json:"paid"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return nil, err
		}
		return d.Money.SetPayout(c.Context(), auth.UserID(c), id, body.Round, body.Paid)
	}))
	g.Post("/:id/cancel", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		return d.Money.CancelGroup(c.Context(), auth.UserID(c), id)
	}))
	g.Post("/:id/link", withID(func(c fiber.Ctx, id uuid.UUID) (*money.Group, error) {
		return d.Money.RotateGroupLink(c.Context(), auth.UserID(c), id)
	}))
	g.Post("/:id/draft", aiLimiter, groupDraft(d))
}

func registerPublicGroups(app *fiber.App, d Deps) {
	limit := func(max int) fiber.Handler {
		return limiter.New(limiter.Config{
			Max:        max,
			Expiration: time.Minute,
			LimitReached: func(c fiber.Ctx) error {
				return jsonError(c, fiber.StatusTooManyRequests, "Too many requests. Please wait a moment.")
			},
		})
	}
	member := func(c fiber.Ctx) string { return c.Get("X-Member-Token") }
	app.Get("/api/public/groups/:token", limit(60), func(c fiber.Ctx) error {
		grp, err := d.Money.PublicGroupByToken(c.Context(), c.Params("token"), member(c))
		if err != nil {
			return moneyError(c, err)
		}
		c.Set(fiber.HeaderCacheControl, "no-store")
		return c.JSON(grp)
	})
	app.Post("/api/public/groups/:token/join", limit(5), func(c fiber.Ctx) error {
		var body struct {
			Name  string `json:"name"`
			Phone string `json:"phone"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		grp, memberToken, err := d.Money.Join(c.Context(), c.Params("token"), body.Name, body.Phone)
		if err != nil {
			return moneyError(c, err)
		}
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"group": grp, "member_token": memberToken})
	})
	app.Post("/api/public/groups/:token/paid", limit(20), func(c fiber.Ctx) error {
		var body struct {
			Round  int    `json:"round"`
			Method string `json:"method"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		grp, err := d.Money.MemberSaysPaid(c.Context(), c.Params("token"), member(c), body.Round, body.Method)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(grp)
	})
}

func groupDraft(d Deps) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		var body struct {
			Purpose  string `json:"purpose"`
			Language string `json:"language"`
			MemberID string `json:"member_id"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		if !money.ReminderLanguages[body.Language] {
			return jsonError(c, fiber.StatusBadRequest, "Messages are available in English and French. Lingala is coming soon.")
		}
		grp, err := d.Money.GetGroup(c.Context(), auth.UserID(c), id)
		if err != nil {
			return moneyError(c, err)
		}
		if grp.Status != "active" || grp.CurrentRound < 1 || grp.CurrentRound > len(grp.Rounds) {
			return jsonError(c, fiber.StatusConflict, "Messages are available while the group is running.")
		}
		r := grp.Rounds[grp.CurrentRound-1]
		in := money.GroupInput{
			Purpose: body.Purpose, Language: body.Language, Group: grp.Name, Organizer: grp.OwnerName,
			Amount: money.FormatAmount(grp.AmountCents, grp.Currency), Round: r.Number, Rounds: len(grp.Rounds),
			Date: r.Date.Format("2006-01-02"), Recipient: r.RecipientName, Pot: money.FormatAmount(grp.PotCents, grp.Currency),
			Paid: r.ReceivedCount + r.SentCount, Members: grp.MemberCount,
		}
		if r.Number < len(grp.Rounds) {
			next := grp.Rounds[r.Number]
			in.NextName, in.NextDate = next.RecipientName, next.Date.Format("2006-01-02")
		}
		switch body.Purpose {
		case "reminder":
			var who *money.Member
			for i := range grp.Members {
				if grp.Members[i].ID.String() == body.MemberID {
					who = &grp.Members[i]
				}
			}
			if who == nil {
				return moneyError(c, money.ErrNotFound)
			}
			for _, p := range r.Payments {
				if p.MemberID == who.ID {
					return jsonError(c, fiber.StatusConflict, "This member has already paid this round.")
				}
			}
			in.Person = who.Name
		case "update":
		default:
			return jsonError(c, fiber.StatusBadRequest, "purpose must be reminder or update.")
		}
		if ok, err := aiAllowed(c, d); !ok {
			return err
		}
		msg, u, err := d.MoneyAI.GroupDraft(c.Context(), in)
		recordAI(c.Context(), d, auth.UserID(c), u)
		if err != nil {
			if !errors.Is(err, money.ErrAIUnusable) {
				log.Printf("money: group draft: %v", err)
				return jsonError(c, fiber.StatusBadGateway, "The assistant is unavailable. You can write the message yourself.")
			}
			return moneyError(c, err)
		}
		return c.JSON(fiber.Map{"message": msg})
	}
}
