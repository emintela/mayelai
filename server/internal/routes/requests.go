package routes

import (
	"errors"
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/money"
	"mayelai/server/internal/push"
)

// Money requests (request / give, Cash App style; no money moves through the app).
//
//	GET  /api/money/requests                 {mine, for_me}
//	POST /api/money/requests                 create (one per recipient; bills can be split)
//	POST /api/money/requests/claim           {token}: link a request I opened to my account
//	GET  /api/money/requests/:id             {request, split}
//	POST /api/money/requests/:id/:action     owner: cancel | accept_counter | received
//	GET  /api/money/profile, PUT /api/money/profile   how people can pay me
//	GET  /api/push/key, POST /api/push/subscribe, POST /api/push/unsubscribe, POST /api/push/test
//
// Public (no account): GET /api/public/requests/:token,
// POST /api/public/requests/:token/:action   accept | decline | counter | sent | received
func registerRequests(m fiber.Router, d Deps) {
	m.Get("/requests", func(c fiber.Ctx) error {
		user := auth.UserID(c)
		mine, err := d.Money.MyRequests(c.Context(), user)
		if err != nil {
			return moneyError(c, err)
		}
		forMe, err := d.Money.RequestsForMe(c.Context(), user)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(fiber.Map{"mine": mine, "for_me": forMe, "push": d.Push.Enabled()})
	})
	m.Post("/requests", func(c fiber.Ctx) error {
		var body struct {
			money.NewRequest
			Today string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		list, err := d.Money.CreateRequests(c.Context(), auth.UserID(c), body.NewRequest, clientToday(body.Today))
		if err != nil {
			return moneyError(c, err)
		}
		for i := range list {
			r := list[i]
			d.Push.Notify(r.CounterpartyUserID(), func(lang string) push.Message { return newRequestMessage(&r, lang) })
		}
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"requests": list})
	})
	m.Post("/requests/claim", func(c fiber.Ctx) error {
		var body struct {
			Token string `json:"token"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		r, role, err := d.Money.ClaimRequest(c.Context(), auth.UserID(c), body.Token)
		if err != nil {
			return moneyError(c, err)
		}
		if role == "owner" {
			return c.JSON(fiber.Map{"role": role, "id": r.ID})
		}
		pr, err := d.Money.PublicView(c.Context(), r)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(fiber.Map{"role": role, "request": pr})
	})
	m.Get("/requests/:id", func(c fiber.Ctx) error {
		id, err := uuid.Parse(c.Params("id"))
		if err != nil {
			return moneyError(c, money.ErrNotFound)
		}
		r, err := d.Money.GetRequest(c.Context(), auth.UserID(c), id)
		if err != nil {
			return moneyError(c, err)
		}
		split := []money.Request{}
		if r.SplitID != nil {
			if split, err = d.Money.SplitParts(c.Context(), auth.UserID(c), *r.SplitID); err != nil {
				return moneyError(c, err)
			}
		}
		return c.JSON(fiber.Map{"request": r, "split": split})
	})
	m.Post("/requests/:id/:action", func(c fiber.Ctx) error {
		id, err := uuid.Parse(c.Params("id"))
		if err != nil {
			return moneyError(c, money.ErrNotFound)
		}
		action := c.Params("action")
		r, err := d.Money.OwnerAction(c.Context(), auth.UserID(c), id, action, clientToday(c.Query("today")))
		if err != nil {
			return moneyError(c, err)
		}
		d.Push.Notify(r.CounterpartyUserID(), func(lang string) push.Message { return ownerActionMessage(r, action, lang) })
		return c.JSON(fiber.Map{"request": r})
	})

	m.Get("/profile", func(c fiber.Ctx) error {
		p, err := d.Money.PayProfile(c.Context(), auth.UserID(c))
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(p)
	})
	m.Put("/profile", func(c fiber.Ctx) error {
		var body money.PayProfile
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		p, err := d.Money.SavePayProfile(c.Context(), auth.UserID(c), body)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(p)
	})
}

func registerPush(api fiber.Router, d Deps) {
	api.Get("/push/key", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"enabled": d.Push.Enabled(), "key": d.Push.PublicKey()})
	})
	api.Post("/push/subscribe", func(c fiber.Ctx) error {
		var body struct {
			Subscription push.Subscription `json:"subscription"`
			Lang         string            `json:"lang"`
		}
		if err := c.Bind().JSON(&body); err != nil {
			return jsonError(c, fiber.StatusBadRequest, "Invalid JSON body")
		}
		if err := d.Push.Subscribe(c.Context(), auth.UserID(c), body.Subscription, body.Lang); err != nil {
			if errors.Is(err, push.ErrInvalid) {
				return jsonError(c, fiber.StatusBadRequest, "This browser's notification details look wrong. Please try again.")
			}
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"ok": true, "enabled": d.Push.Enabled()})
	})
	api.Post("/push/unsubscribe", func(c fiber.Ctx) error {
		var body struct {
			Endpoint string `json:"endpoint"`
		}
		if err := c.Bind().JSON(&body); err != nil {
			return jsonError(c, fiber.StatusBadRequest, "Invalid JSON body")
		}
		if err := d.Push.Unsubscribe(c.Context(), auth.UserID(c), body.Endpoint); err != nil {
			return internal(c, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	})
	api.Post("/push/test", func(c fiber.Ctx) error {
		d.Push.Notify(auth.UserID(c), func(lang string) push.Message {
			if lang == "fr" {
				return push.Message{Title: "onSave", Body: "Les alertes sont activées.", URL: "/onsave/me", Tag: "test"}
			}
			return push.Message{Title: "onSave", Body: "Alerts are on.", URL: "/onsave/me", Tag: "test"}
		})
		return c.JSON(fiber.Map{"ok": true, "enabled": d.Push.Enabled()})
	})
}

func registerPublicRequests(app *fiber.App, d Deps, ipLimit fiber.Handler) {
	app.Get("/api/public/requests/:token", ipLimit, func(c fiber.Ctx) error {
		_, pr, err := d.Money.RequestByToken(c.Context(), c.Params("token"))
		if err != nil {
			return moneyError(c, err)
		}
		c.Set(fiber.HeaderCacheControl, "no-store")
		return c.JSON(pr)
	})
	app.Post("/api/public/requests/:token/:action", ipLimit, func(c fiber.Ctx) error {
		var body struct {
			money.Reply
			Today string `json:"today"`
		}
		if err := decodeStrict(c, &body); err != nil {
			return moneyError(c, err)
		}
		action := c.Params("action")
		r, err := d.Money.RespondRequest(c.Context(), c.Params("token"), action, body.Reply, clientToday(body.Today))
		if err != nil {
			return moneyError(c, err)
		}
		d.Push.Notify(r.OwnerID(), func(lang string) push.Message { return replyMessage(r, action, lang) })
		pr, err := d.Money.PublicView(c.Context(), r)
		if err != nil {
			return moneyError(c, err)
		}
		return c.JSON(pr)
	})
}

// ---------- notification text ----------

// amountText: "$50", "$12.50", "CA$80", "€20" (en) / "50 $", "12,50 $", "80 $ CA", "20 €" (fr).
func amountText(cents int64, currency, lang string) string {
	n := fmt.Sprintf("%d", cents/100)
	if cents%100 != 0 {
		sep := "."
		if lang == "fr" {
			sep = ","
		}
		n += fmt.Sprintf("%s%02d", sep, cents%100)
	}
	if lang == "fr" {
		return n + map[string]string{"USD": " $", "CAD": " $ CA", "EUR": " €"}[currency]
	}
	return map[string]string{"USD": "$", "CAD": "CA$", "EUR": "€"}[currency] + n
}

func pick(lang, en, fr string) string {
	if lang == "fr" {
		return fr
	}
	return en
}

func orTap(note, lang string) string {
	if strings.TrimSpace(note) != "" {
		return note
	}
	return pick(lang, "Tap to answer.", "Touchez pour répondre.")
}

// To the other person, when a request is created for them.
func newRequestMessage(r *money.Request, lang string) push.Message {
	a, who := amountText(r.AmountCents, r.Currency, lang), r.OwnerName
	if who == "" {
		who = pick(lang, "Someone", "Quelqu'un")
	}
	var title string
	switch r.Kind {
	case "borrow":
		title = pick(lang, who+" would like to borrow "+a, who+" aimerait emprunter "+a)
	case "help":
		title = pick(lang, who+" asks for your help: "+a, who+" demande votre aide : "+a)
	case "gift":
		title = pick(lang, who+" sent you "+a, who+" vous a envoyé "+a)
	default:
		title = pick(lang, who+" requests "+a, who+" vous demande "+a)
	}
	body := orTap(r.Note, lang)
	if r.Kind == "gift" {
		body = pick(lang, "Tap to confirm you received it.", "Touchez pour confirmer la réception.")
		if r.Note != "" {
			body = r.Note
		}
	}
	return push.Message{Title: title, Body: body, URL: "/r/" + r.ShareToken, Tag: "req-" + r.ID.String()}
}

// To the owner, when the other person answers.
func replyMessage(r *money.Request, action, lang string) push.Message {
	a, who := amountText(r.AmountCents, r.Currency, lang), r.CounterpartyName
	msg := push.Message{URL: "/onsave/money/requests/" + r.ID.String(), Tag: "req-" + r.ID.String(), Body: r.ResponseNote}
	switch action {
	case "accept":
		msg.Title = pick(lang, who+" accepted your request for "+a, who+" a accepté votre demande de "+a)
		if msg.Body == "" {
			msg.Body = pick(lang, "They'll let you know when it's sent.", "Vous serez prévenu quand ce sera envoyé.")
		}
	case "decline":
		msg.Title = pick(lang, who+" declined your request for "+a, who+" a refusé votre demande de "+a)
	case "counter":
		offer := a
		if r.CounterAmountCents != nil {
			offer = amountText(*r.CounterAmountCents, r.Currency, lang)
		}
		msg.Title = pick(lang, who+" offered "+offer+" instead of "+a, who+" propose "+offer+" au lieu de "+a)
		if msg.Body == "" {
			msg.Body = pick(lang, "Tap to accept or cancel.", "Touchez pour accepter ou annuler.")
		}
	case "sent":
		msg.Title = pick(lang, who+" sent you "+a, who+" vous a envoyé "+a)
		via := ""
		if r.Method != "" {
			via = pick(lang, " by "+r.Method, " par "+r.Method)
		}
		msg.Body = pick(lang, "Sent"+via+". Confirm when you receive it.", "Envoyé"+via+". Confirmez à la réception.")
	case "received":
		msg.Title = pick(lang, who+" received your "+a, who+" a bien reçu vos "+a)
		msg.Body = r.ThanksNote
	}
	if msg.Body == "" {
		msg.Body = "onSave"
	}
	return msg
}

// To the other person, when the owner acts.
func ownerActionMessage(r *money.Request, action, lang string) push.Message {
	a, who := amountText(r.AmountCents, r.Currency, lang), r.OwnerName
	if who == "" {
		who = pick(lang, "They", "La personne")
	}
	msg := push.Message{URL: "/r/" + r.ShareToken, Tag: "req-" + r.ID.String(), Body: "onSave"}
	switch action {
	case "accept_counter":
		msg.Title = pick(lang, who+" accepted your offer of "+a, who+" a accepté votre offre de "+a)
		msg.Body = pick(lang, "Tap to see how to pay.", "Touchez pour voir comment payer.")
	case "received":
		msg.Title = pick(lang, who+" confirmed receiving "+a, who+" a confirmé avoir reçu "+a)
		msg.Body = pick(lang, "All settled. Thank you!", "Tout est réglé. Merci !")
	case "cancel":
		msg.Title = pick(lang, who+" cancelled the request for "+a, who+" a annulé la demande de "+a)
	}
	return msg
}
