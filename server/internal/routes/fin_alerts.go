package routes

import (
	"context"
	"log"
	"time"

	"github.com/gofiber/fiber/v3"

	"mayelai/server/internal/auth"
	"mayelai/server/internal/fin"
	"mayelai/server/internal/push"
)

var catEn = map[string]string{
	"TOTAL": "Your spending", "FOOD_AND_DRINK": "Food & dining", "RENT_AND_UTILITIES": "Housing & bills", "TRANSPORTATION": "Transportation",
	"GENERAL_MERCHANDISE": "Shopping", "ENTERTAINMENT": "Entertainment", "PERSONAL_CARE": "Personal care", "MEDICAL": "Health",
	"TRAVEL": "Travel", "HOME_IMPROVEMENT": "Home", "GENERAL_SERVICES": "Services", "GOVERNMENT_AND_NON_PROFIT": "Taxes & giving",
	"BANK_FEES": "Bank fees", "OTHER": "Other",
}
var catFr = map[string]string{
	"TOTAL": "Vos dépenses", "FOOD_AND_DRINK": "Alimentation et restos", "RENT_AND_UTILITIES": "Logement et factures", "TRANSPORTATION": "Transport",
	"GENERAL_MERCHANDISE": "Achats", "ENTERTAINMENT": "Loisirs", "PERSONAL_CARE": "Soins personnels", "MEDICAL": "Santé",
	"TRAVEL": "Voyages", "HOME_IMPROVEMENT": "Maison", "GENERAL_SERVICES": "Services", "GOVERNMENT_AND_NON_PROFIT": "Impôts et dons",
	"BANK_FEES": "Frais bancaires", "OTHER": "Autre",
}

func catText(c, lang string) string {
	m := catEn
	if lang == "fr" {
		m = catFr
	}
	if n, ok := m[c]; ok {
		return n
	}
	return c
}

// finAlertMessage is the push notification for one alert.
func finAlertMessage(a fin.Alert, lang string) push.Message {
	amt := amountText(a.AmountCents, a.Currency, lang)
	cat := catText(a.Category, lang)
	m := push.Message{URL: "/onsave/alerts", Tag: "fin-" + a.Kind + "-" + a.Category}
	switch a.Kind {
	case "over_budget":
		m.Title = pick(lang, "Over budget", "Budget dépassé")
		m.Body = pick(lang, cat+" is "+amt+" over this month's budget.", cat+" dépasse le budget du mois de "+amt+".")
	case "near_budget":
		m.Title = pick(lang, "Budget almost used", "Budget presque épuisé")
		m.Body = pick(lang, cat+": only "+amt+" left this month.", cat+" : il ne reste que "+amt+" ce mois-ci.")
	case "low_balance":
		m.Title = pick(lang, "Low balance", "Solde bas")
		m.Body = pick(lang, "Your bank balance is down to "+amt+".", "Votre solde bancaire est descendu à "+amt+".")
	case "large_charge":
		m.Title = pick(lang, "Large charge", "Grosse dépense")
		m.Body = pick(lang, amt+" at "+a.Name+".", amt+" chez "+a.Name+".")
		m.Tag = "fin-large-" + a.ID.String()
	case "bill_due":
		m.Title = pick(lang, "Bill coming up", "Facture à venir")
		m.Body = pick(lang, a.Name+" (about "+amt+") is due in the next few days.", a.Name+" (environ "+amt+") arrive dans les prochains jours.")
	default:
		m.Title, m.Body = "Mayel'AI", a.Kind
	}
	return m
}

// FinNotifier sends each new alert as a push alert (texts come later).
func FinNotifier(p *push.Service) fin.Notifier {
	return func(user string, a fin.Alert, _ fin.AlertSettings) {
		p.Notify(user, func(lang string) push.Message { return finAlertMessage(a, lang) })
	}
}

// StartFinSync refreshes banks in the background every interval, so alerts
// arrive even when nobody opens the app.
func StartFinSync(ctx context.Context, f *fin.Service, every, olderThan time.Duration) {
	if !f.Enabled() {
		return
	}
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				c, cancel := context.WithTimeout(ctx, every)
				f.SyncAll(c, olderThan)
				cancel()
			}
		}
	}()
	log.Printf("[FIN] background sync every %s", every)
}

// SMS isn't wired yet (Twilio comes later).
const smsAvailable = false

// GET  /api/fin/alerts             {alerts, unread, settings, sms_available}
// POST /api/fin/alerts/read
// PUT  /api/fin/alert-settings     AlertSettings
func registerFinAlerts(f fiber.Router, d Deps, on fiber.Handler) {
	f.Get("/alerts", on, func(c fiber.Ctx) error {
		user := auth.UserID(c)
		list, unread, err := d.Fin.Alerts(c.Context(), user)
		if err != nil {
			return finError(c, err)
		}
		set, err := d.Fin.AlertSettings(c.Context(), user)
		if err != nil {
			return finError(c, err)
		}
		return c.JSON(fiber.Map{"alerts": list, "unread": unread, "settings": set, "sms_available": smsAvailable})
	})
	f.Post("/alerts/read", on, func(c fiber.Ctx) error {
		if err := d.Fin.MarkAlertsRead(c.Context(), auth.UserID(c)); err != nil {
			return finError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	})
	f.Put("/alert-settings", on, func(c fiber.Ctx) error {
		var body fin.AlertSettings
		if err := decodeStrict(c, &body); err != nil {
			return finError(c, fin.ErrInvalid)
		}
		set, err := d.Fin.SaveAlertSettings(c.Context(), auth.UserID(c), body, smsAvailable)
		if err != nil {
			return finError(c, err)
		}
		return c.JSON(set)
	})
}
