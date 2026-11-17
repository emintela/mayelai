// Package money is Mayel'AI's family-money module, stage A: an IOU tracker.
//
// The app never holds or moves money. An owner records a loan ("I lent Patrick
// $200"), shares a link so the other person can confirm it without an account,
// records repayments as they happen (Zelle, mobile money, cash…) and sends
// polite reminders through their own WhatsApp/SMS.
//
// Every owner query filters by owner_id, so another user's loan is
// indistinguishable from a missing one (ErrNotFound).
package money

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

var (
	ErrNotFound = errors.New("not found")
	// ErrState means the action doesn't fit the loan's current status.
	ErrState = errors.New("invalid state")
)

// ValidationError carries a message that is safe to show the user.
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func invalid(format string, a ...any) error { return &ValidationError{fmt.Sprintf(format, a...)} }

// Currencies supported at launch. All have 2 decimal places.
var Currencies = map[string]bool{"USD": true, "EUR": true, "CAD": true}

// Languages for reminders. Lingala ("ln") is reserved for a later release.
var ReminderLanguages = map[string]bool{"en": true, "fr": true}

const (
	maxAmountCents = 100_000_000 // 1,000,000.00
	dateLayout     = "2006-01-02"
)

// Date is a calendar date serialized as "YYYY-MM-DD".
type Date struct{ time.Time }

func (d Date) MarshalJSON() ([]byte, error) { return []byte(`"` + d.Format(dateLayout) + `"`), nil }

func ParseDate(s string) (Date, error) {
	t, err := time.Parse(dateLayout, strings.TrimSpace(s))
	if err != nil {
		return Date{}, invalid("Dates must look like 2026-11-30.")
	}
	return Date{t}, nil
}

var amountRe = regexp.MustCompile(`^\d{1,7}(\.\d{1,2})?$`)

// ParseAmount turns "200", "200.5" or "200.50" into cents. Commas used as
// thousands separators ("1,200.00") are accepted; a lone comma decimal
// ("200,50", common in French) is treated as a decimal point.
func ParseAmount(s string) (int64, error) {
	s = strings.TrimSpace(strings.ReplaceAll(s, " ", ""))
	if strings.Count(s, ",") == 1 && !strings.Contains(s, ".") && len(s)-strings.Index(s, ",") <= 3 {
		s = strings.Replace(s, ",", ".", 1)
	}
	s = strings.ReplaceAll(s, ",", "")
	if !amountRe.MatchString(s) {
		return 0, invalid("Enter an amount like 200 or 200.50.")
	}
	whole, frac, _ := strings.Cut(s, ".")
	for len(frac) < 2 {
		frac += "0"
	}
	w, _ := strconv.ParseInt(whole, 10, 64)
	f, _ := strconv.ParseInt(frac, 10, 64)
	cents := w*100 + f
	if cents <= 0 {
		return 0, invalid("The amount must be more than zero.")
	}
	if cents > maxAmountCents {
		return 0, invalid("The amount is too large (maximum 1,000,000).")
	}
	return cents, nil
}

// FormatAmount renders cents as "200.50 USD" (used in AI prompts).
func FormatAmount(cents int64, currency string) string {
	return fmt.Sprintf("%d.%02d %s", cents/100, cents%100, currency)
}

func newToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func cleanText(s string, max int, field string) (string, error) {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > max {
		return "", invalid("%s must be at most %d characters.", field, max)
	}
	return s, nil
}

var phoneRe = regexp.MustCompile(`^\+?[0-9 ()\-.]{6,24}$`)

// ---------- loans ----------

type Payment struct {
	ID          uuid.UUID `json:"id"`
	AmountCents int64     `json:"amount_cents"`
	PaidOn      Date      `json:"paid_on"`
	Method      string    `json:"method"`
	Note        string    `json:"note"`
	CreatedAt   time.Time `json:"created_at"`
}

type Reminder struct {
	ID        uuid.UUID `json:"id"`
	Channel   string    `json:"channel"`
	Language  string    `json:"language"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

type Loan struct {
	ID                uuid.UUID  `json:"id"`
	OwnerName         string     `json:"owner_name"`
	Direction         string     `json:"direction"` // "lent" or "borrowed", from the owner's side
	CounterpartyName  string     `json:"counterparty_name"`
	CounterpartyPhone *string    `json:"counterparty_phone"`
	AmountCents       int64      `json:"amount_cents"`
	PaidCents         int64      `json:"paid_cents"`
	OutstandingCents  int64      `json:"outstanding_cents"`
	Currency          string     `json:"currency"`
	LentOn            Date       `json:"lent_on"`
	DueOn             *Date      `json:"due_on"`
	Note              string     `json:"note"`
	ReminderLanguage  string     `json:"reminder_language"`
	Status            string     `json:"status"` // open, paid, forgiven, cancelled
	ClosedAt          *time.Time `json:"closed_at"`
	ShareToken        string     `json:"share_token"`
	Response          string     `json:"response"` // pending, confirmed, declined
	ResponseNote      string     `json:"response_note"`
	RespondedAt       *time.Time `json:"responded_at"`
	LastRemindedAt    *time.Time `json:"last_reminded_at"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	Payments          []Payment  `json:"payments,omitempty"`
	Reminders         []Reminder `json:"reminders,omitempty"`
}

// NewLoan is the create request.
type NewLoan struct {
	OwnerName         string `json:"owner_name"`
	Direction         string `json:"direction"`
	CounterpartyName  string `json:"counterparty_name"`
	CounterpartyPhone string `json:"counterparty_phone"`
	Amount            string `json:"amount"`
	Currency          string `json:"currency"`
	LentOn            string `json:"lent_on"` // default: today
	DueOn             string `json:"due_on"`  // optional
	Note              string `json:"note"`
	ReminderLanguage  string `json:"reminder_language"`
}

type validLoan struct {
	ownerName, direction, name, currency, note, lang string
	phone                                            *string
	cents                                            int64
	lentOn                                           Date
	dueOn                                            *Date
}

func (n NewLoan) validate(today time.Time) (*validLoan, error) {
	var v validLoan
	var err error
	if v.ownerName, err = cleanText(n.OwnerName, 80, "Your name"); err != nil {
		return nil, err
	}
	switch n.Direction {
	case "lent", "borrowed":
		v.direction = n.Direction
	default:
		return nil, invalid(`direction must be "lent" or "borrowed".`)
	}
	if v.name, err = cleanText(n.CounterpartyName, 80, "Name"); err != nil {
		return nil, err
	}
	if v.name == "" {
		return nil, invalid("Enter the person's name.")
	}
	if p := strings.TrimSpace(n.CounterpartyPhone); p != "" {
		if !phoneRe.MatchString(p) {
			return nil, invalid("Enter a valid phone number, for example +1 555 123 4567.")
		}
		v.phone = &p
	}
	if v.cents, err = ParseAmount(n.Amount); err != nil {
		return nil, err
	}
	v.currency = strings.ToUpper(strings.TrimSpace(n.Currency))
	if !Currencies[v.currency] {
		return nil, invalid("Currency must be USD, EUR or CAD.")
	}
	v.lentOn = Date{today}
	if n.LentOn != "" {
		if v.lentOn, err = ParseDate(n.LentOn); err != nil {
			return nil, err
		}
	}
	if v.lentOn.After(today.AddDate(0, 0, 1)) {
		return nil, invalid("The loan date can't be in the future.")
	}
	if n.DueOn != "" {
		d, err := ParseDate(n.DueOn)
		if err != nil {
			return nil, err
		}
		if d.Before(v.lentOn.Time) {
			return nil, invalid("The due date can't be before the loan date.")
		}
		v.dueOn = &d
	}
	if v.note, err = cleanText(n.Note, 500, "Note"); err != nil {
		return nil, err
	}
	v.lang = n.ReminderLanguage
	if v.lang == "" {
		v.lang = "fr"
	}
	if !ReminderLanguages[v.lang] {
		return nil, invalid("Reminder language must be en or fr (Lingala is coming soon).")
	}
	return &v, nil
}

// LoanPatch edits an open loan's details. Nil fields are unchanged; an empty
// string clears due_on / counterparty_phone.
type LoanPatch struct {
	CounterpartyName  *string `json:"counterparty_name"`
	CounterpartyPhone *string `json:"counterparty_phone"`
	DueOn             *string `json:"due_on"`
	Note              *string `json:"note"`
	ReminderLanguage  *string `json:"reminder_language"`
}

// NewPayment records a repayment.
type NewPayment struct {
	Amount string `json:"amount"`
	PaidOn string `json:"paid_on"` // default: today
	Method string `json:"method"`
	Note   string `json:"note"`
}
