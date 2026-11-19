package money

// Money requests: ask someone for money (borrow, "you owe me", help, bill
// split) or record a gift you gave. The other person answers through a share
// link. Nothing is ever paid through the app: people pay the way they already
// do and tap "I sent it" / "I received it".
//
// Who pays: for borrow, owed and help the other person pays the owner;
// for gift the owner already paid the other person.
//
// Status flow (requests):
//
//	pending ─accept→ accepted ─"I sent it"→ sent ─owner "received"→ received
//	pending ─counter→ countered ─owner accepts the offer→ accepted
//	pending|countered|accepted ─decline→ declined     (the other person)
//	pending|countered|accepted ─cancel→ cancelled     (the owner)
//
// Gifts start as sent; the other person confirms "received" (with a thank-you).
// When a borrow request is received it becomes a loan in the owner's Money.

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var RequestKinds = map[string]bool{"borrow": true, "owed": true, "help": true, "gift": true}

// ErrRequestTaken: the request was already opened by another signed-in account.
var ErrRequestTaken = errors.New("money: request linked to another account")

const maxRecipients = 20

type Request struct {
	ID                 uuid.UUID  `json:"id"`
	OwnerName          string     `json:"owner_name"`
	Kind               string     `json:"kind"`
	CounterpartyName   string     `json:"counterparty_name"`
	CounterpartyPhone  *string    `json:"counterparty_phone"`
	Linked             bool       `json:"linked"` // the other person has opened it signed in (gets push alerts)
	AmountCents        int64      `json:"amount_cents"`
	Currency           string     `json:"currency"`
	Note               string     `json:"note"`
	DueOn              *Date      `json:"due_on"`
	Status             string     `json:"status"`
	CounterAmountCents *int64     `json:"counter_amount_cents"`
	CounterDueOn       *Date      `json:"counter_due_on"`
	ResponseNote       string     `json:"response_note"`
	Method             string     `json:"method"`
	ThanksNote         string     `json:"thanks_note"`
	SplitID            *uuid.UUID `json:"split_id"`
	LoanID             *uuid.UUID `json:"loan_id"`
	ShareToken         string     `json:"share_token"`
	RespondedAt        *time.Time `json:"responded_at"`
	SentAt             *time.Time `json:"sent_at"`
	ReceivedAt         *time.Time `json:"received_at"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`

	ownerID, counterpartyUserID string
}

func (r *Request) OwnerID() string            { return r.ownerID }
func (r *Request) CounterpartyUserID() string { return r.counterpartyUserID }

// OwnerReceives: the money goes to the owner (everything except gifts).
func (r *Request) OwnerReceives() bool { return r.Kind != "gift" }

// Open: still waiting on someone.
func (r *Request) Open() bool {
	switch r.Status {
	case "pending", "countered", "accepted", "sent":
		return true
	}
	return false
}

const reqCols = `id, owner_id, owner_name, kind, counterparty_name, counterparty_phone, counterparty_user_id,
	amount_cents, currency, note, due_on, status, counter_amount_cents, counter_due_on, response_note,
	method, thanks_note, split_id, loan_id, share_token, responded_at, sent_at, received_at, created_at, updated_at`

func scanRequest(row pgx.Row) (*Request, error) {
	var r Request
	var cpUser *string
	var due, counterDue *time.Time
	err := row.Scan(&r.ID, &r.ownerID, &r.OwnerName, &r.Kind, &r.CounterpartyName, &r.CounterpartyPhone, &cpUser,
		&r.AmountCents, &r.Currency, &r.Note, &due, &r.Status, &r.CounterAmountCents, &counterDue, &r.ResponseNote,
		&r.Method, &r.ThanksNote, &r.SplitID, &r.LoanID, &r.ShareToken, &r.RespondedAt, &r.SentAt, &r.ReceivedAt,
		&r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if cpUser != nil {
		r.counterpartyUserID = *cpUser
		r.Linked = true
	}
	if due != nil {
		r.DueOn = &Date{*due}
	}
	if counterDue != nil {
		r.CounterDueOn = &Date{*counterDue}
	}
	return &r, nil
}

func scanRequests(rows pgx.Rows) ([]Request, error) {
	defer rows.Close()
	out := []Request{}
	for rows.Next() {
		r, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// ---------- create ----------

type Recipient struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

// NewRequest creates one request per recipient. With Split, Amount is the
// total and is shared equally (IncludeMe counts the owner as one of the people).
type NewRequest struct {
	Kind       string      `json:"kind"`
	OwnerName  string      `json:"owner_name"`
	Recipients []Recipient `json:"recipients"`
	Amount     string      `json:"amount"`
	Currency   string      `json:"currency"`
	Note       string      `json:"note"`
	DueOn      string      `json:"due_on"`
	Split      bool        `json:"split"`
	IncludeMe  bool        `json:"include_me"`
	Method     string      `json:"method"` // gift: how it was sent
}

type validRecipient struct {
	name  string
	phone *string
	cents int64
}

func (n NewRequest) validate(today time.Time) (ownerName, note, method, currency string, due *time.Time, people []validRecipient, err error) {
	if !RequestKinds[n.Kind] {
		err = invalid("Choose what this is for.")
		return
	}
	if ownerName, err = cleanText(n.OwnerName, 80, "Your name"); err != nil {
		return
	}
	if note, err = cleanText(n.Note, 300, "Note"); err != nil {
		return
	}
	if method, err = cleanText(n.Method, 40, "Payment method"); err != nil {
		return
	}
	currency = strings.ToUpper(strings.TrimSpace(n.Currency))
	if !Currencies[currency] {
		err = invalid("Currency must be USD, EUR or CAD.")
		return
	}
	total, err := ParseAmount(n.Amount)
	if err != nil {
		return
	}
	if len(n.Recipients) == 0 {
		err = invalid("Choose who this is for.")
		return
	}
	if len(n.Recipients) > maxRecipients {
		err = invalid("You can send to at most %d people at once.", maxRecipients)
		return
	}
	if n.Split && n.Kind != "owed" {
		err = invalid("Only bills can be split.")
		return
	}
	if n.DueOn != "" {
		d, e := ParseDate(n.DueOn)
		if e != nil {
			err = e
			return
		}
		if d.Before(today) {
			err = invalid("The date can't be in the past.")
			return
		}
		due = &d.Time
	}
	// Equal shares; the first people absorb the leftover cents.
	shares, each, extra := int64(len(n.Recipients)), total, int64(0)
	if n.Split {
		if n.IncludeMe {
			shares++
		}
		each, extra = total/shares, total%shares
		if each == 0 {
			err = invalid("The amount is too small to split.")
			return
		}
	}
	for i, rc := range n.Recipients {
		name, e := cleanText(rc.Name, 80, "Name")
		if e != nil {
			err = e
			return
		}
		if name == "" {
			err = invalid("Enter each person's name.")
			return
		}
		v := validRecipient{name: name, cents: each}
		if n.Split && int64(i) < extra {
			v.cents++
		}
		if p := strings.TrimSpace(rc.Phone); p != "" {
			if !phoneRe.MatchString(p) {
				err = invalid("Enter a valid phone number for %s, for example +1 555 123 4567.", name)
				return
			}
			v.phone = &p
		}
		people = append(people, v)
	}
	return
}

// CreateRequests inserts one request per recipient. A recipient whose phone
// matches someone who already opened one of the owner's requests signed in is
// linked to that account right away (so they get a push alert).
func (s *Store) CreateRequests(ctx context.Context, owner string, n NewRequest, today time.Time) ([]Request, error) {
	ownerName, note, method, currency, due, people, err := n.validate(today)
	if err != nil {
		return nil, err
	}
	var splitID *uuid.UUID
	if n.Split {
		id := uuid.New()
		splitID = &id
	}
	status, sentAt := "pending", (*time.Time)(nil)
	if n.Kind == "gift" {
		now := time.Now()
		status, sentAt = "sent", &now
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	ids := make([]uuid.UUID, 0, len(people))
	for _, p := range people {
		var id uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO money_requests (owner_id, owner_name, kind, counterparty_name, counterparty_phone, counterparty_user_id,
				amount_cents, currency, note, due_on, status, method, split_id, share_token, sent_at)
			VALUES ($1, $2, $3, $4, $5,
				(SELECT r.counterparty_user_id FROM money_requests r
				 WHERE r.owner_id = $1 AND r.counterparty_user_id IS NOT NULL AND $5::text IS NOT NULL
				   AND regexp_replace(r.counterparty_phone, '[^0-9]', '', 'g') = regexp_replace($5::text, '[^0-9]', '', 'g')
				 ORDER BY r.created_at DESC LIMIT 1),
				$6, $7, $8, $9, $10, $11, $12, $13, $14)
			RETURNING id`,
			owner, ownerName, n.Kind, p.name, p.phone, p.cents, currency, note, due, status, method, splitID, newToken(), sentAt).Scan(&id)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT `+reqCols+` FROM money_requests WHERE id = ANY($1) ORDER BY created_at, id`, ids)
	if err != nil {
		return nil, err
	}
	return scanRequests(rows)
}

// ---------- read ----------

// MyRequests lists the requests the owner created (newest first).
func (s *Store) MyRequests(ctx context.Context, owner string) ([]Request, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+reqCols+` FROM money_requests WHERE owner_id = $1
		ORDER BY created_at DESC LIMIT 300`, owner)
	if err != nil {
		return nil, err
	}
	return scanRequests(rows)
}

// RequestsForMe lists requests other people sent to this signed-in user.
func (s *Store) RequestsForMe(ctx context.Context, user string) ([]PublicRequest, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+reqCols+` FROM money_requests
		WHERE counterparty_user_id = $1 AND owner_id <> $1 AND status <> 'cancelled'
		ORDER BY updated_at DESC LIMIT 200`, user)
	if err != nil {
		return nil, err
	}
	list, err := scanRequests(rows)
	if err != nil {
		return nil, err
	}
	out := make([]PublicRequest, 0, len(list))
	for i := range list {
		pr, err := s.publicView(ctx, &list[i])
		if err != nil {
			return nil, err
		}
		out = append(out, *pr)
	}
	return out, nil
}

func (s *Store) GetRequest(ctx context.Context, owner string, id uuid.UUID) (*Request, error) {
	return scanRequest(s.pool.QueryRow(ctx, `SELECT `+reqCols+` FROM money_requests WHERE id = $1 AND owner_id = $2`, id, owner))
}

// SplitParts returns every request of a bill split (owner only).
func (s *Store) SplitParts(ctx context.Context, owner string, splitID uuid.UUID) ([]Request, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+reqCols+` FROM money_requests WHERE owner_id = $1 AND split_id = $2
		ORDER BY created_at, id`, owner, splitID)
	if err != nil {
		return nil, err
	}
	return scanRequests(rows)
}

// ---------- changes ----------

// change locks one request, lets fn update it (and use the transaction), then saves it.
func (s *Store) change(ctx context.Context, where string, arg any, fn func(tx pgx.Tx, r *Request) error) (*Request, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	r, err := scanRequest(tx.QueryRow(ctx, `SELECT `+reqCols+` FROM money_requests WHERE `+where+` FOR UPDATE`, arg))
	if err != nil {
		return nil, err
	}
	if err := fn(tx, r); err != nil {
		return nil, err
	}
	var due, counterDue *time.Time
	if r.DueOn != nil {
		due = &r.DueOn.Time
	}
	if r.CounterDueOn != nil {
		counterDue = &r.CounterDueOn.Time
	}
	var cpUser *string
	if r.counterpartyUserID != "" {
		cpUser = &r.counterpartyUserID
	}
	if _, err := tx.Exec(ctx, `UPDATE money_requests SET status = $2, amount_cents = $3, due_on = $4,
		counter_amount_cents = $5, counter_due_on = $6, response_note = $7, method = $8, thanks_note = $9,
		loan_id = $10, counterparty_user_id = $11, responded_at = $12, sent_at = $13, received_at = $14, updated_at = now()
		WHERE id = $1`,
		r.ID, r.Status, r.AmountCents, due, r.CounterAmountCents, counterDue, r.ResponseNote, r.Method, r.ThanksNote,
		r.LoanID, cpUser, r.RespondedAt, r.SentAt, r.ReceivedAt); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return scanRequest(s.pool.QueryRow(ctx, `SELECT `+reqCols+` FROM money_requests WHERE id = $1`, r.ID))
}

func oneOf(s string, list ...string) bool {
	for _, v := range list {
		if s == v {
			return true
		}
	}
	return false
}

// OwnerAction: "cancel", "accept_counter" or "received".
func (s *Store) OwnerAction(ctx context.Context, owner string, id uuid.UUID, action string, today time.Time) (*Request, error) {
	return s.change(ctx, "id = $1", id, func(tx pgx.Tx, r *Request) error {
		if r.ownerID != owner {
			return ErrNotFound
		}
		now := time.Now()
		switch action {
		case "cancel":
			if !oneOf(r.Status, "pending", "countered", "accepted") && !(r.Kind == "gift" && r.Status == "sent") {
				return ErrState
			}
			r.Status = "cancelled"
		case "accept_counter":
			if r.Status != "countered" || r.CounterAmountCents == nil {
				return ErrState
			}
			r.AmountCents = *r.CounterAmountCents
			if r.CounterDueOn != nil {
				r.DueOn = r.CounterDueOn
			}
			r.Status = "accepted"
		case "received":
			if !r.OwnerReceives() || !oneOf(r.Status, "pending", "accepted", "sent") {
				return ErrState
			}
			r.Status, r.ReceivedAt = "received", &now
			if r.Kind == "borrow" {
				return borrowToLoan(ctx, tx, r, today)
			}
		default:
			return invalid("Unknown action.")
		}
		return nil
	})
}

// borrowToLoan records a received borrow request as a loan the owner owes,
// already confirmed by the lender.
func borrowToLoan(ctx context.Context, tx pgx.Tx, r *Request, today time.Time) error {
	var due *time.Time
	if r.DueOn != nil && !r.DueOn.Before(today) {
		due = &r.DueOn.Time
	}
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
		INSERT INTO money_loans (owner_id, owner_name, direction, counterparty_name, counterparty_phone,
			amount_cents, currency, lent_on, due_on, note, share_token, response, responded_at)
		VALUES ($1, $2, 'borrowed', $3, $4, $5, $6, $7, $8, $9, $10, 'confirmed', now())
		RETURNING id`,
		r.ownerID, r.OwnerName, r.CounterpartyName, r.CounterpartyPhone, r.AmountCents, r.Currency, today, due,
		r.Note, newToken()).Scan(&id)
	if err != nil {
		return err
	}
	r.LoanID = &id
	return nil
}

// Reply is what the other person sends from the share link.
type Reply struct {
	Note   string `json:"note"`
	Amount string `json:"amount"` // counter
	DueOn  string `json:"due_on"` // counter
	Method string `json:"method"` // sent
}

// Respond: the other person's answer through the link — "accept", "decline",
// "counter", "sent" (they paid) or "received" (a gift reached them).
func (s *Store) RespondRequest(ctx context.Context, token, action string, rp Reply, today time.Time) (*Request, error) {
	if !validToken(token) {
		return nil, ErrNotFound
	}
	note, err := cleanText(rp.Note, 300, "Message")
	if err != nil {
		return nil, err
	}
	method, err := cleanText(rp.Method, 40, "Payment method")
	if err != nil {
		return nil, err
	}
	return s.change(ctx, "share_token = $1", token, func(_ pgx.Tx, r *Request) error {
		now := time.Now()
		ask := r.OwnerReceives()
		switch action {
		case "accept":
			if !ask || r.Status != "pending" {
				return ErrState
			}
			r.Status, r.RespondedAt = "accepted", &now
			if note != "" {
				r.ResponseNote = note
			}
		case "decline":
			if !ask || !oneOf(r.Status, "pending", "countered", "accepted") {
				return ErrState
			}
			r.Status, r.ResponseNote, r.RespondedAt = "declined", note, &now
		case "counter":
			if !ask || r.Status != "pending" {
				return ErrState
			}
			cents, err := ParseAmount(rp.Amount)
			if err != nil {
				return err
			}
			r.CounterAmountCents, r.CounterDueOn = &cents, nil
			if rp.DueOn != "" {
				d, err := ParseDate(rp.DueOn)
				if err != nil {
					return err
				}
				if d.Before(today) {
					return invalid("The date can't be in the past.")
				}
				r.CounterDueOn = &d
			}
			r.Status, r.ResponseNote, r.RespondedAt = "countered", note, &now
		case "sent":
			if !ask || !oneOf(r.Status, "pending", "accepted") {
				return ErrState
			}
			r.Status, r.Method, r.SentAt = "sent", method, &now
			if r.RespondedAt == nil {
				r.RespondedAt = &now
			}
			if note != "" {
				r.ResponseNote = note
			}
		case "received":
			if ask || r.Status != "sent" {
				return ErrState
			}
			r.Status, r.ThanksNote, r.ReceivedAt = "received", note, &now
		default:
			return invalid("Unknown action.")
		}
		return nil
	})
}

// ClaimRequest links a request to the signed-in person who opened its link,
// so it shows in their app and they get alerts. Role is "owner" when it's
// their own request, otherwise "counterparty".
func (s *Store) ClaimRequest(ctx context.Context, user, token string) (*Request, string, error) {
	if !validToken(token) {
		return nil, "", ErrNotFound
	}
	role := "counterparty"
	r, err := s.change(ctx, "share_token = $1", token, func(_ pgx.Tx, r *Request) error {
		switch {
		case r.ownerID == user:
			role = "owner"
		case r.counterpartyUserID == "":
			r.counterpartyUserID = user
		case r.counterpartyUserID != user:
			return ErrRequestTaken
		}
		return nil
	})
	return r, role, err
}

// ---------- public view ----------

// PublicRequest is what the other person sees: no phone number, plus the
// owner's payment handles when the owner is the one receiving money.
type PublicRequest struct {
	Token              string      `json:"token"`
	OwnerName          string      `json:"owner_name"`
	Kind               string      `json:"kind"`
	CounterpartyName   string      `json:"counterparty_name"`
	AmountCents        int64       `json:"amount_cents"`
	Currency           string      `json:"currency"`
	Note               string      `json:"note"`
	DueOn              *Date       `json:"due_on"`
	Status             string      `json:"status"`
	CounterAmountCents *int64      `json:"counter_amount_cents"`
	CounterDueOn       *Date       `json:"counter_due_on"`
	ResponseNote       string      `json:"response_note"`
	Method             string      `json:"method"`
	ThanksNote         string      `json:"thanks_note"`
	Split              bool        `json:"split"`
	RespondedAt        *time.Time  `json:"responded_at"`
	SentAt             *time.Time  `json:"sent_at"`
	ReceivedAt         *time.Time  `json:"received_at"`
	CreatedAt          time.Time   `json:"created_at"`
	UpdatedAt          time.Time   `json:"updated_at"`
	PayTo              *PayProfile `json:"pay_to,omitempty"`
}

func (s *Store) publicView(ctx context.Context, r *Request) (*PublicRequest, error) {
	pr := &PublicRequest{
		Token: r.ShareToken, OwnerName: r.OwnerName, Kind: r.Kind, CounterpartyName: r.CounterpartyName,
		AmountCents: r.AmountCents, Currency: r.Currency, Note: r.Note, DueOn: r.DueOn, Status: r.Status,
		CounterAmountCents: r.CounterAmountCents, CounterDueOn: r.CounterDueOn, ResponseNote: r.ResponseNote,
		Method: r.Method, ThanksNote: r.ThanksNote, Split: r.SplitID != nil, RespondedAt: r.RespondedAt,
		SentAt: r.SentAt, ReceivedAt: r.ReceivedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
	if r.OwnerReceives() && r.Open() {
		p, err := s.PayProfile(ctx, r.ownerID)
		if err != nil {
			return nil, err
		}
		if !p.Empty() {
			pr.PayTo = p
		}
	}
	return pr, nil
}

// RequestByToken loads the public view of a request.
func (s *Store) RequestByToken(ctx context.Context, token string) (*Request, *PublicRequest, error) {
	if !validToken(token) {
		return nil, nil, ErrNotFound
	}
	r, err := scanRequest(s.pool.QueryRow(ctx, `SELECT `+reqCols+` FROM money_requests WHERE share_token = $1`, token))
	if err != nil {
		return nil, nil, err
	}
	pr, err := s.publicView(ctx, r)
	return r, pr, err
}

// PublicView exposes the public view of a request already loaded.
func (s *Store) PublicView(ctx context.Context, r *Request) (*PublicRequest, error) {
	return s.publicView(ctx, r)
}

// ---------- pay profile ----------

// PayProfile: how people can pay you. Shown on your requests.
type PayProfile struct {
	Cashtag     string `json:"cashtag"`      // Cash App, without the $
	Venmo       string `json:"venmo"`        // username, without the @
	PayPal      string `json:"paypal"`       // paypal.me username
	Zelle       string `json:"zelle"`        // email or phone
	Interac     string `json:"interac"`      // email or phone
	MobileMoney string `json:"mobile_money"` // M-Pesa / Orange Money number
}

func (p *PayProfile) Empty() bool {
	return p.Cashtag == "" && p.Venmo == "" && p.PayPal == "" && p.Zelle == "" && p.Interac == "" && p.MobileMoney == ""
}

func (s *Store) PayProfile(ctx context.Context, user string) (*PayProfile, error) {
	var p PayProfile
	err := s.pool.QueryRow(ctx, `SELECT cashtag, venmo, paypal, zelle, interac, mobile_money
		FROM money_pay_profiles WHERE user_id = $1`, user).
		Scan(&p.Cashtag, &p.Venmo, &p.PayPal, &p.Zelle, &p.Interac, &p.MobileMoney)
	if errors.Is(err, pgx.ErrNoRows) {
		return &PayProfile{}, nil
	}
	return &p, err
}

var handleRe = regexp.MustCompile(`^[A-Za-z0-9_.\-]{1,40}$`)

func (s *Store) SavePayProfile(ctx context.Context, user string, p PayProfile) (*PayProfile, error) {
	clean := func(v string, max int, field string, prefixes ...string) (string, error) {
		v = strings.TrimSpace(v)
		for _, pre := range prefixes {
			if len(v) >= len(pre) && strings.EqualFold(v[:len(pre)], pre) {
				v = v[len(pre):]
			}
		}
		return cleanText(v, max, field)
	}
	var err error
	if p.Cashtag, err = clean(p.Cashtag, 40, "Cash App", "https://cash.app/", "cash.app/", "$"); err != nil {
		return nil, err
	}
	if p.Venmo, err = clean(p.Venmo, 40, "Venmo", "https://venmo.com/u/", "venmo.com/u/", "https://venmo.com/", "venmo.com/", "@"); err != nil {
		return nil, err
	}
	if p.PayPal, err = clean(p.PayPal, 40, "PayPal", "https://paypal.me/", "https://www.paypal.me/", "paypal.me/", "www.paypal.me/"); err != nil {
		return nil, err
	}
	for _, h := range []struct{ v, name string }{{p.Cashtag, "Cash App"}, {p.Venmo, "Venmo"}, {p.PayPal, "PayPal"}} {
		if h.v != "" && !handleRe.MatchString(h.v) {
			return nil, invalid("Check your %s name: letters, numbers, dots, dashes and underscores only.", h.name)
		}
	}
	if p.Zelle, err = clean(p.Zelle, 80, "Zelle"); err != nil {
		return nil, err
	}
	if p.Interac, err = clean(p.Interac, 80, "Interac"); err != nil {
		return nil, err
	}
	if p.MobileMoney, err = clean(p.MobileMoney, 40, "Mobile money"); err != nil {
		return nil, err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO money_pay_profiles (user_id, cashtag, venmo, paypal, zelle, interac, mobile_money)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id) DO UPDATE SET cashtag = $2, venmo = $3, paypal = $4, zelle = $5, interac = $6,
			mobile_money = $7, updated_at = now()`,
		user, p.Cashtag, p.Venmo, p.PayPal, p.Zelle, p.Interac, p.MobileMoney)
	if err != nil {
		return nil, err
	}
	return &p, nil
}
