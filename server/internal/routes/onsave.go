package routes

import (
	"github.com/gofiber/fiber/v3"

	"mayelai/server/internal/auth"
)

// onSave: the likelemba app for signed-in people (organizers and members).
// Organizer actions keep using /api/money/groups/:id/...
//
//	GET  /api/onsave/groups                  groups I organize or belong to
//	GET  /api/onsave/groups/:id
//	POST /api/onsave/groups/:id/paid         {round, method}  my own contribution
//	POST /api/onsave/join/:token             {name, phone}    join a forming group with my account
//	POST /api/onsave/claim                   {token, member_token}  link a personal link to my account
//	GET  /api/onsave/activity
func registerOnSave(api fiber.Router, d Deps) {
	o := api.Group("/onsave")
	o.Get("/groups", func(c fiber.Ctx) error {
		list, err := d.Money.MyGroups(c.Context(), auth.UserID(c))
		if err != nil {
			return internal(c, err)
		}
		p, _, err := plan(c, d)
		if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"groups": list, "plan": p, "active_limit": d.Config.ActiveGroupsFor(p)})
	})
	o.Get("/groups/:id", func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		g, err := d.Money.MyGroup(c.Context(), auth.UserID(c), id)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(g)
	})
	o.Post("/groups/:id/paid", func(c fiber.Ctx) error {
		id, err := loanID(c, "id")
		if err != nil {
			return moneyError(c, err)
		}
		var body struct {
			Round  int    `json:"round"`
			Method string `json:"method"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		g, err := d.Money.PayAsMember(c.Context(), auth.UserID(c), id, body.Round, body.Method)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(g)
	})
	o.Post("/join/:token", func(c fiber.Ctx) error {
		var body struct {
			Name  string `json:"name"`
			Phone string `json:"phone"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		g, err := d.Money.JoinAsUser(c.Context(), auth.UserID(c), c.Params("token"), body.Name, body.Phone)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(g)
	})
	o.Post("/claim", func(c fiber.Ctx) error {
		var body struct {
			Token       string `json:"token"`
			MemberToken string `json:"member_token"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		id, err := d.Money.ClaimMember(c.Context(), auth.UserID(c), body.Token, body.MemberToken)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(fiber.Map{"group_id": id})
	})
	o.Get("/activity", func(c fiber.Ctx) error {
		events, err := d.Money.Activity(c.Context(), auth.UserID(c), 60)
		if err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"events": events})
	})
}
