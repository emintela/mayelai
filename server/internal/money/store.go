package money

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// loanCols selects a loan plus its paid total and last reminder time.
const loanCols = `l.id, l.owner_name, l.direction, l.counterparty_name, l.counterparty_phone, l.amount_cents,
	COALESCE((SELECT sum(p.amount_cents) FROM money_payments p WHERE p.loan_id = l.id), 0),
	l.currency, l.lent_on, l.due_on, l.note, l.reminder_language, l.status, l.closed_at,
	l.share_token, l.response, l.response_note, l.responded_at,
	(SELECT max(r.created_at) FROM money_reminders r WHERE r.loan_id = l.id),
	l.created_at, l.updated_at`

func scanLoan(row pgx.Row) (*Loan, error) {
	var l Loan
	var lent time.Time
	var due *time.Time
	err := row.Scan(&l.ID, &l.OwnerName, &l.Direction, &l.CounterpartyName, &l.CounterpartyPhone, &l.AmountCents,
		&l.PaidCents, &l.Currency, &lent, &due, &l.Note, &l.ReminderLanguage, &l.Status, &l.ClosedAt,
		&l.ShareToken, &l.Response, &l.ResponseNote, &l.RespondedAt, &l.LastRemindedAt,
		&l.CreatedAt, &l.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	l.LentOn = Date{lent}
	if due != nil {
		l.DueOn = &Date{*due}
	}
	l.OutstandingCents = max(l.AmountCents-l.PaidCents, 0)
	return &l, nil
}

// CountOpen counts the owner's open loans (for the free-plan limit).
func (s *Store) CountOpen(ctx context.Context, owner string) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM money_loans WHERE owner_id = $1 AND status = 'open'`, owner).Scan(&n)
	return n, err
}

// Create validates and inserts a loan. maxOpen > 0 caps the owner's open
// loans (free plan); it is checked inside the transaction with the owner's
// rows locked, so concurrent requests can't exceed it.
func (s *Store) Create(ctx context.Context, owner string, n NewLoan, today time.Time, maxOpen int) (*Loan, error) {
	v, err := n.validate(today)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if maxOpen > 0 {
		// Serialize creates per owner.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('money:' || $1))`, owner); err != nil {
			return nil, err
		}
		var open int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM money_loans WHERE owner_id = $1 AND status = 'open'`, owner).Scan(&open); err != nil {
			return nil, err
		}
		if open >= maxOpen {
			return nil, &LimitError{Max: maxOpen, Kind: "loans"}
		}
	}
	var dueOn *time.Time
	if v.dueOn != nil {
		dueOn = &v.dueOn.Time
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO money_loans (owner_id, owner_name, direction, counterparty_name, counterparty_phone,
			amount_cents, currency, lent_on, due_on, note, reminder_language, share_token)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id`,
		owner, v.ownerName, v.direction, v.name, v.phone, v.cents, v.currency, v.lentOn.Time, dueOn,
		v.note, v.lang, newToken()).Scan(&id); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.Get(ctx, owner, id)
}

// LimitError means a free-plan limit was reached. Kind is "loans" or "collections".
type LimitError struct {
	Max  int
	Kind string
}

func (e *LimitError) Error() string { return "open " + e.Kind + " limit reached" }

// List returns the owner's loans: status "open", "closed" (paid/forgiven/cancelled) or "" for all.
func (s *Store) List(ctx context.Context, owner, status string) ([]Loan, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+loanCols+` FROM money_loans l
		WHERE l.owner_id = $1
		  AND ($2 = '' OR ($2 = 'open' AND l.status = 'open') OR ($2 = 'closed' AND l.status <> 'open'))
		ORDER BY (l.status = 'open') DESC, l.due_on ASC NULLS LAST, l.created_at DESC
		LIMIT 500`, owner, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Loan{}
	for rows.Next() {
		l, err := scanLoan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

// Get returns one of the owner's loans with its payments and reminders.
func (s *Store) Get(ctx context.Context, owner string, id uuid.UUID) (*Loan, error) {
	l, err := scanLoan(s.pool.QueryRow(ctx, `SELECT `+loanCols+` FROM money_loans l WHERE l.id = $1 AND l.owner_id = $2`, id, owner))
	if err != nil {
		return nil, err
	}
	if l.Payments, err = s.payments(ctx, id); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT id, channel, language, message, created_at FROM money_reminders
		WHERE loan_id = $1 ORDER BY created_at DESC LIMIT 50`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	l.Reminders = []Reminder{}
	for rows.Next() {
		var r Reminder
		if err := rows.Scan(&r.ID, &r.Channel, &r.Language, &r.Message, &r.CreatedAt); err != nil {
			return nil, err
		}
		l.Reminders = append(l.Reminders, r)
	}
	return l, rows.Err()
}

func (s *Store) payments(ctx context.Context, loanID uuid.UUID) ([]Payment, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, amount_cents, paid_on, method, note, created_at FROM money_payments
		WHERE loan_id = $1 ORDER BY paid_on, created_at`, loanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Payment{}
	for rows.Next() {
		var p Payment
		var paid time.Time
		if err := rows.Scan(&p.ID, &p.AmountCents, &paid, &p.Method, &p.Note, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.PaidOn = Date{paid}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Update edits an open loan's details.
func (s *Store) Update(ctx context.Context, owner string, id uuid.UUID, p LoanPatch) (*Loan, error) {
	cur, err := s.Get(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	if cur.Status != "open" {
		return nil, ErrState
	}
	name, phone, note, lang := cur.CounterpartyName, cur.CounterpartyPhone, cur.Note, cur.ReminderLanguage
	var due *time.Time
	if cur.DueOn != nil {
		due = &cur.DueOn.Time
	}
	if p.CounterpartyName != nil {
		if name, err = cleanText(*p.CounterpartyName, 80, "Name"); err != nil {
			return nil, err
		}
		if name == "" {
			return nil, invalid("Enter the person's name.")
		}
	}
	if p.CounterpartyPhone != nil {
		v := strings.TrimSpace(*p.CounterpartyPhone)
		if v != "" && !phoneRe.MatchString(v) {
			return nil, invalid("Enter a valid phone number, for example +1 555 123 4567.")
		}
		phone = nil
		if v != "" {
			phone = &v
		}
	}
	if p.DueOn != nil {
		due = nil
		if *p.DueOn != "" {
			d, err := ParseDate(*p.DueOn)
			if err != nil {
				return nil, err
			}
			if d.Before(cur.LentOn.Time) {
				return nil, invalid("The due date can't be before the loan date.")
			}
			due = &d.Time
		}
	}
	if p.Note != nil {
		if note, err = cleanText(*p.Note, 500, "Note"); err != nil {
			return nil, err
		}
	}
	if p.ReminderLanguage != nil {
		if !ReminderLanguages[*p.ReminderLanguage] {
			return nil, invalid("Reminder language must be en or fr (Lingala is coming soon).")
		}
		lang = *p.ReminderLanguage
	}
	if _, err := s.pool.Exec(ctx, `
		UPDATE money_loans SET counterparty_name = $3, counterparty_phone = $4, due_on = $5, note = $6,
			reminder_language = $7, updated_at = now()
		WHERE id = $1 AND owner_id = $2`, id, owner, name, phone, due, note, lang); err != nil {
		return nil, err
	}
	return s.Get(ctx, owner, id)
}

// lockOpen locks one of the owner's loans and returns its status and outstanding amount.
func lockLoan(ctx context.Context, tx pgx.Tx, owner string, id uuid.UUID) (status string, amount, paid int64, err error) {
	err = tx.QueryRow(ctx, `SELECT status, amount_cents FROM money_loans WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
		id, owner).Scan(&status, &amount)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", 0, 0, ErrNotFound
	}
	if err != nil {
		return "", 0, 0, err
	}
	err = tx.QueryRow(ctx, `SELECT COALESCE(sum(amount_cents), 0) FROM money_payments WHERE loan_id = $1`, id).Scan(&paid)
	return status, amount, paid, err
}

// AddPayment records a repayment on an open loan. A payment can't exceed what
// is still owed; when the balance reaches zero the loan closes as paid.
func (s *Store) AddPayment(ctx context.Context, owner string, id uuid.UUID, n NewPayment, today time.Time) (*Loan, error) {
	cents, err := ParseAmount(n.Amount)
	if err != nil {
		return nil, err
	}
	paidOn := Date{today}
	if n.PaidOn != "" {
		if paidOn, err = ParseDate(n.PaidOn); err != nil {
			return nil, err
		}
	}
	if paidOn.After(today.AddDate(0, 0, 1)) {
		return nil, invalid("The payment date can't be in the future.")
	}
	method, err := cleanText(n.Method, 40, "Method")
	if err != nil {
		return nil, err
	}
	note, err := cleanText(n.Note, 300, "Note")
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	status, amount, paid, err := lockLoan(ctx, tx, owner, id)
	if err != nil {
		return nil, err
	}
	if status != "open" {
		return nil, ErrState
	}
	if cents > amount-paid {
		return nil, invalid("That's more than what's still owed (%s).", strings.TrimSpace(FormatAmount(amount-paid, "")))
	}
	if _, err := tx.Exec(ctx, `INSERT INTO money_payments (loan_id, amount_cents, paid_on, method, note)
		VALUES ($1, $2, $3, $4, $5)`, id, cents, paidOn.Time, method, note); err != nil {
		return nil, err
	}
	if paid+cents >= amount {
		if _, err := tx.Exec(ctx, `UPDATE money_loans SET status = 'paid', closed_at = now(), updated_at = now() WHERE id = $1`, id); err != nil {
			return nil, err
		}
	} else if _, err := tx.Exec(ctx, `UPDATE money_loans SET updated_at = now() WHERE id = $1`, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.Get(ctx, owner, id)
}

// DeletePayment removes a recorded payment (e.g. entered by mistake). A loan
// that was closed as paid reopens if money is owed again.
func (s *Store) DeletePayment(ctx context.Context, owner string, loanID, paymentID uuid.UUID) (*Loan, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	status, _, _, err := lockLoan(ctx, tx, owner, loanID)
	if err != nil {
		return nil, err
	}
	if status == "forgiven" || status == "cancelled" {
		return nil, ErrState
	}
	tag, err := tx.Exec(ctx, `DELETE FROM money_payments WHERE id = $1 AND loan_id = $2`, paymentID, loanID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	if status == "paid" {
		if _, err := tx.Exec(ctx, `UPDATE money_loans SET status = 'open', closed_at = NULL, updated_at = now() WHERE id = $1`, loanID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.Get(ctx, owner, loanID)
}

// SetStatus closes a loan ("paid" settles the rest without a payment record,
// "forgiven", "cancelled") or reopens it ("open"). Reopening is subject to the
// same open-loan limit as creating.
func (s *Store) SetStatus(ctx context.Context, owner string, id uuid.UUID, status string, maxOpen int) (*Loan, error) {
	switch status {
	case "open", "paid", "forgiven", "cancelled":
	default:
		return nil, invalid("status must be open, paid, forgiven or cancelled.")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if status == "open" && maxOpen > 0 {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('money:' || $1))`, owner); err != nil {
			return nil, err
		}
	}
	cur, amount, paid, err := lockLoan(ctx, tx, owner, id)
	if err != nil {
		return nil, err
	}
	if cur == status {
		return s.Get(ctx, owner, id) // idempotent
	}
	if status == "open" {
		if paid >= amount {
			return nil, ErrState // nothing left to owe
		}
		if maxOpen > 0 {
			var open int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM money_loans WHERE owner_id = $1 AND status = 'open'`, owner).Scan(&open); err != nil {
				return nil, err
			}
			if open >= maxOpen {
				return nil, &LimitError{Max: maxOpen, Kind: "loans"}
			}
		}
		_, err = tx.Exec(ctx, `UPDATE money_loans SET status = 'open', closed_at = NULL, updated_at = now() WHERE id = $1`, id)
	} else {
		if cur != "open" {
			return nil, ErrState // reopen first to change how it was closed
		}
		_, err = tx.Exec(ctx, `UPDATE money_loans SET status = $2, closed_at = now(), updated_at = now() WHERE id = $1`, id, status)
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.Get(ctx, owner, id)
}

// Delete removes a loan and its history.
func (s *Store) Delete(ctx context.Context, owner string, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM money_loans WHERE id = $1 AND owner_id = $2`, id, owner)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// RotateLink issues a new share link; the old one stops working.
func (s *Store) RotateLink(ctx context.Context, owner string, id uuid.UUID) (*Loan, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE money_loans SET share_token = $3, response = 'pending', response_note = '',
		responded_at = NULL, updated_at = now() WHERE id = $1 AND owner_id = $2`, id, owner, newToken())
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.Get(ctx, owner, id)
}

// LogReminder records a reminder the owner sent through their own app.
func (s *Store) LogReminder(ctx context.Context, owner string, id uuid.UUID, channel, language, message string) (*Loan, error) {
	switch channel {
	case "whatsapp", "sms", "copy":
	default:
		return nil, invalid("channel must be whatsapp, sms or copy.")
	}
	if !ReminderLanguages[language] {
		return nil, invalid("language must be en or fr.")
	}
	msg, err := cleanText(message, 1000, "Message")
	if err != nil {
		return nil, err
	}
	if msg == "" {
		return nil, invalid("The message is empty.")
	}
	tag, err := s.pool.Exec(ctx, `INSERT INTO money_reminders (loan_id, channel, language, message)
		SELECT id, $3, $4, $5 FROM money_loans WHERE id = $1 AND owner_id = $2`, id, owner, channel, language, msg)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.Get(ctx, owner, id)
}

// ---------- shared link (no account) ----------

// PublicLoan is what the other person sees through the share link: no
// payment notes, reminder history or phone numbers.
type PublicLoan struct {
	OwnerName        string     `json:"owner_name"`
	Direction        string     `json:"direction"` // owner's side: "lent" means the viewer borrowed
	CounterpartyName string     `json:"counterparty_name"`
	AmountCents      int64      `json:"amount_cents"`
	PaidCents        int64      `json:"paid_cents"`
	OutstandingCents int64      `json:"outstanding_cents"`
	Currency         string     `json:"currency"`
	LentOn           Date       `json:"lent_on"`
	DueOn            *Date      `json:"due_on"`
	Note             string     `json:"note"`
	Status           string     `json:"status"`
	Response         string     `json:"response"`
	ResponseNote     string     `json:"response_note"`
	RespondedAt      *time.Time `json:"responded_at"`
}

func validToken(t string) bool { return len(t) == 32 && !strings.ContainsAny(t, "/?#") }

// ByToken loads the public view of a shared loan.
func (s *Store) ByToken(ctx context.Context, token string) (*PublicLoan, error) {
	if !validToken(token) {
		return nil, ErrNotFound
	}
	l, err := scanLoan(s.pool.QueryRow(ctx, `SELECT `+loanCols+` FROM money_loans l WHERE l.share_token = $1`, token))
	if err != nil {
		return nil, err
	}
	return &PublicLoan{
		OwnerName: l.OwnerName, Direction: l.Direction, CounterpartyName: l.CounterpartyName,
		AmountCents: l.AmountCents, PaidCents: l.PaidCents, OutstandingCents: l.OutstandingCents,
		Currency: l.Currency, LentOn: l.LentOn, DueOn: l.DueOn, Note: l.Note, Status: l.Status,
		Response: l.Response, ResponseNote: l.ResponseNote, RespondedAt: l.RespondedAt,
	}, nil
}

// Respond records the other person's answer ("confirmed" or "declined").
// They can change it while the loan is open.
func (s *Store) Respond(ctx context.Context, token, response, note string) (*PublicLoan, error) {
	if response != "confirmed" && response != "declined" {
		return nil, invalid(`response must be "confirmed" or "declined".`)
	}
	note, err := cleanText(note, 300, "Message")
	if err != nil {
		return nil, err
	}
	if !validToken(token) {
		return nil, ErrNotFound
	}
	tag, err := s.pool.Exec(ctx, `UPDATE money_loans SET response = $2, response_note = $3, responded_at = now(),
		updated_at = now() WHERE share_token = $1 AND status = 'open'`, token, response, note)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		if _, err := s.ByToken(ctx, token); err != nil {
			return nil, err
		}
		return nil, ErrState // exists but closed
	}
	return s.ByToken(ctx, token)
}
