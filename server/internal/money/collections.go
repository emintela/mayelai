package money

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Collections for family events. The organizer owns the collection; anyone
// with the share link can pledge. Contribution statuses:
//   pledged  → promised
//   sent     → the giver says they sent it (not yet confirmed)
//   received → the organizer confirmed the money arrived

var CollectionKinds = map[string]bool{"funeral": true, "wedding": true, "birth": true, "medical": true, "other": true}

const maxContributionsPerCollection = 1000

type Contribution struct {
	ID             uuid.UUID  `json:"id"`
	Name           string     `json:"name"`
	Phone          *string    `json:"phone"`
	AmountCents    int64      `json:"amount_cents"`
	Message        string     `json:"message"`
	HideName       bool       `json:"hide_name"`
	HideAmount     bool       `json:"hide_amount"`
	Status         string     `json:"status"`
	Method         string     `json:"method"`
	Source         string     `json:"source"`
	SentAt         *time.Time `json:"sent_at"`
	ReceivedAt     *time.Time `json:"received_at"`
	LastRemindedAt *time.Time `json:"last_reminded_at"`
	RemindersCount int        `json:"reminders_count"`
	CreatedAt      time.Time  `json:"created_at"`
}

type Totals struct {
	PledgedCents  int64 `json:"pledged_cents"`  // every contribution
	SentCents     int64 `json:"sent_cents"`     // sent but not confirmed
	ReceivedCents int64 `json:"received_cents"` // confirmed by the organizer
	Count         int   `json:"count"`
}

type Collection struct {
	ID            uuid.UUID      `json:"id"`
	OwnerName     string         `json:"owner_name"`
	Kind          string         `json:"kind"`
	Title         string         `json:"title"`
	Beneficiary   string         `json:"beneficiary"`
	Description   string         `json:"description"`
	Currency      string         `json:"currency"`
	GoalCents     *int64         `json:"goal_cents"`
	Deadline      *Date          `json:"deadline"`
	ShowAmounts   bool           `json:"show_amounts"`
	Status        string         `json:"status"`
	ClosedAt      *time.Time     `json:"closed_at"`
	ShareToken    string         `json:"share_token"`
	Totals        Totals         `json:"totals"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	Contributions []Contribution `json:"contributions,omitempty"`
}

// NewCollection is the create request; CollectionPatch edits an open one.
type NewCollection struct {
	OwnerName   string `json:"owner_name"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Beneficiary string `json:"beneficiary"`
	Description string `json:"description"`
	Currency    string `json:"currency"`
	Goal        string `json:"goal"`     // optional amount
	Deadline    string `json:"deadline"` // optional YYYY-MM-DD
	ShowAmounts *bool  `json:"show_amounts"`
}

type CollectionPatch struct {
	Title       *string `json:"title"`
	Beneficiary *string `json:"beneficiary"`
	Description *string `json:"description"`
	Goal        *string `json:"goal"`     // "" clears
	Deadline    *string `json:"deadline"` // "" clears
	ShowAmounts *bool   `json:"show_amounts"`
}

// NewContribution comes from the public link or from the organizer.
type NewContribution struct {
	Name       string `json:"name"`
	Phone      string `json:"phone"`
	Amount     string `json:"amount"`
	Message    string `json:"message"`
	HideName   bool   `json:"hide_name"`
	HideAmount bool   `json:"hide_amount"`
	Sent       bool   `json:"sent"`     // public: "I already sent it"
	Received   bool   `json:"received"` // organizer only: money already in hand
	Method     string `json:"method"`
}

type validCollection struct {
	ownerName, kind, title, beneficiary, description, currency string
	goal                                                       *int64
	deadline                                                   *time.Time
	showAmounts                                                bool
}

func (n NewCollection) validate(today time.Time) (*validCollection, error) {
	var v validCollection
	var err error
	if v.ownerName, err = cleanText(n.OwnerName, 80, "Your name"); err != nil {
		return nil, err
	}
	if !CollectionKinds[n.Kind] {
		return nil, invalid("Choose what the collection is for.")
	}
	v.kind = n.Kind
	if v.title, err = cleanText(n.Title, 120, "Title"); err != nil {
		return nil, err
	}
	if v.title == "" {
		return nil, invalid("Give the collection a title.")
	}
	if v.beneficiary, err = cleanText(n.Beneficiary, 120, "For whom"); err != nil {
		return nil, err
	}
	if v.description, err = cleanText(n.Description, 1000, "Description"); err != nil {
		return nil, err
	}
	v.currency = strings.ToUpper(strings.TrimSpace(n.Currency))
	if !Currencies[v.currency] {
		return nil, invalid("Currency must be USD, EUR or CAD.")
	}
	if strings.TrimSpace(n.Goal) != "" {
		g, err := ParseAmount(n.Goal)
		if err != nil {
			return nil, err
		}
		v.goal = &g
	}
	if n.Deadline != "" {
		d, err := ParseDate(n.Deadline)
		if err != nil {
			return nil, err
		}
		if d.Before(today) {
			return nil, invalid("The deadline can't be in the past.")
		}
		v.deadline = &d.Time
	}
	v.showAmounts = n.ShowAmounts == nil || *n.ShowAmounts
	return &v, nil
}

type validContribution struct {
	name, message, method string
	phone                 *string
	cents                 int64
	hideName, hideAmount  bool
	status                string
}

func (n NewContribution) validate(fromOrganizer bool) (*validContribution, error) {
	var v validContribution
	var err error
	if v.name, err = cleanText(n.Name, 80, "Name"); err != nil {
		return nil, err
	}
	if v.name == "" {
		return nil, invalid("Enter a name.")
	}
	if p := strings.TrimSpace(n.Phone); p != "" {
		if !phoneRe.MatchString(p) {
			return nil, invalid("Enter a valid phone number, for example +243 81 234 5678.")
		}
		v.phone = &p
	}
	if v.cents, err = ParseAmount(n.Amount); err != nil {
		return nil, err
	}
	if v.message, err = cleanText(n.Message, 300, "Message"); err != nil {
		return nil, err
	}
	if v.method, err = cleanText(n.Method, 40, "Method"); err != nil {
		return nil, err
	}
	v.hideName, v.hideAmount = n.HideName, n.HideAmount
	v.status = "pledged"
	switch {
	case n.Received:
		if !fromOrganizer {
			return nil, invalid("Only the organizer can mark money as received.")
		}
		v.status = "received"
	case n.Sent:
		v.status = "sent"
	}
	return &v, nil
}

// ---------- store ----------

const collectionCols = `c.id, c.owner_name, c.kind, c.title, c.beneficiary, c.description, c.currency, c.goal_cents,
	c.deadline, c.show_amounts, c.status, c.closed_at, c.share_token, c.created_at, c.updated_at,
	COALESCE((SELECT sum(amount_cents) FROM money_contributions x WHERE x.collection_id = c.id), 0),
	COALESCE((SELECT sum(amount_cents) FROM money_contributions x WHERE x.collection_id = c.id AND x.status = 'sent'), 0),
	COALESCE((SELECT sum(amount_cents) FROM money_contributions x WHERE x.collection_id = c.id AND x.status = 'received'), 0),
	(SELECT count(*) FROM money_contributions x WHERE x.collection_id = c.id)`

func scanCollection(row pgx.Row) (*Collection, error) {
	var c Collection
	var deadline *time.Time
	err := row.Scan(&c.ID, &c.OwnerName, &c.Kind, &c.Title, &c.Beneficiary, &c.Description, &c.Currency, &c.GoalCents,
		&deadline, &c.ShowAmounts, &c.Status, &c.ClosedAt, &c.ShareToken, &c.CreatedAt, &c.UpdatedAt,
		&c.Totals.PledgedCents, &c.Totals.SentCents, &c.Totals.ReceivedCents, &c.Totals.Count)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if deadline != nil {
		c.Deadline = &Date{*deadline}
	}
	return &c, nil
}

const contributionCols = `id, name, phone, amount_cents, message, hide_name, hide_amount, status, method, source,
	sent_at, received_at, last_reminded_at, reminders_count, created_at`

func (s *Store) contributions(ctx context.Context, collectionID uuid.UUID) ([]Contribution, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+contributionCols+` FROM money_contributions
		WHERE collection_id = $1 ORDER BY created_at`, collectionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Contribution{}
	for rows.Next() {
		var c Contribution
		if err := rows.Scan(&c.ID, &c.Name, &c.Phone, &c.AmountCents, &c.Message, &c.HideName, &c.HideAmount,
			&c.Status, &c.Method, &c.Source, &c.SentAt, &c.ReceivedAt, &c.LastRemindedAt, &c.RemindersCount,
			&c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateCollection inserts a collection; maxOpen > 0 caps the organizer's open collections.
func (s *Store) CreateCollection(ctx context.Context, owner string, n NewCollection, today time.Time, maxOpen int) (*Collection, error) {
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
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('collections:' || $1))`, owner); err != nil {
			return nil, err
		}
		var open int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM money_collections WHERE owner_id = $1 AND status = 'open'`, owner).Scan(&open); err != nil {
			return nil, err
		}
		if open >= maxOpen {
			return nil, &LimitError{Max: maxOpen, Kind: "collections"}
		}
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO money_collections (owner_id, owner_name, kind, title, beneficiary, description, currency,
			goal_cents, deadline, show_amounts, share_token)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
		owner, v.ownerName, v.kind, v.title, v.beneficiary, v.description, v.currency, v.goal, v.deadline,
		v.showAmounts, newToken()).Scan(&id); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetCollection(ctx, owner, id)
}

// ListCollections returns the organizer's collections (open first).
func (s *Store) ListCollections(ctx context.Context, owner string) ([]Collection, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+collectionCols+` FROM money_collections c WHERE c.owner_id = $1
		ORDER BY (c.status = 'open') DESC, c.created_at DESC LIMIT 200`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Collection{}
	for rows.Next() {
		c, err := scanCollection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// GetCollection returns one of the organizer's collections with all contributions (including phones).
func (s *Store) GetCollection(ctx context.Context, owner string, id uuid.UUID) (*Collection, error) {
	c, err := scanCollection(s.pool.QueryRow(ctx, `SELECT `+collectionCols+` FROM money_collections c
		WHERE c.id = $1 AND c.owner_id = $2`, id, owner))
	if err != nil {
		return nil, err
	}
	c.Contributions, err = s.contributions(ctx, id)
	return c, err
}

func (s *Store) UpdateCollection(ctx context.Context, owner string, id uuid.UUID, p CollectionPatch, today time.Time) (*Collection, error) {
	cur, err := s.GetCollection(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	if cur.Status != "open" {
		return nil, ErrState
	}
	title, beneficiary, description, goal, show := cur.Title, cur.Beneficiary, cur.Description, cur.GoalCents, cur.ShowAmounts
	var deadline *time.Time
	if cur.Deadline != nil {
		deadline = &cur.Deadline.Time
	}
	if p.Title != nil {
		if title, err = cleanText(*p.Title, 120, "Title"); err != nil {
			return nil, err
		}
		if title == "" {
			return nil, invalid("Give the collection a title.")
		}
	}
	if p.Beneficiary != nil {
		if beneficiary, err = cleanText(*p.Beneficiary, 120, "For whom"); err != nil {
			return nil, err
		}
	}
	if p.Description != nil {
		if description, err = cleanText(*p.Description, 1000, "Description"); err != nil {
			return nil, err
		}
	}
	if p.Goal != nil {
		goal = nil
		if strings.TrimSpace(*p.Goal) != "" {
			g, err := ParseAmount(*p.Goal)
			if err != nil {
				return nil, err
			}
			goal = &g
		}
	}
	if p.Deadline != nil {
		deadline = nil
		if *p.Deadline != "" {
			d, err := ParseDate(*p.Deadline)
			if err != nil {
				return nil, err
			}
			if d.Before(today) {
				return nil, invalid("The deadline can't be in the past.")
			}
			deadline = &d.Time
		}
	}
	if p.ShowAmounts != nil {
		show = *p.ShowAmounts
	}
	if _, err := s.pool.Exec(ctx, `UPDATE money_collections SET title = $3, beneficiary = $4, description = $5,
		goal_cents = $6, deadline = $7, show_amounts = $8, updated_at = now() WHERE id = $1 AND owner_id = $2`,
		id, owner, title, beneficiary, description, goal, deadline, show); err != nil {
		return nil, err
	}
	return s.GetCollection(ctx, owner, id)
}

// SetCollectionStatus closes ("closed") or reopens ("open") a collection.
func (s *Store) SetCollectionStatus(ctx context.Context, owner string, id uuid.UUID, status string, maxOpen int) (*Collection, error) {
	if status != "open" && status != "closed" {
		return nil, invalid("status must be open or closed.")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if status == "open" && maxOpen > 0 {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('collections:' || $1))`, owner); err != nil {
			return nil, err
		}
	}
	var cur string
	err = tx.QueryRow(ctx, `SELECT status FROM money_collections WHERE id = $1 AND owner_id = $2 FOR UPDATE`, id, owner).Scan(&cur)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if cur != status {
		if status == "open" && maxOpen > 0 {
			var open int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM money_collections WHERE owner_id = $1 AND status = 'open'`, owner).Scan(&open); err != nil {
				return nil, err
			}
			if open >= maxOpen {
				return nil, &LimitError{Max: maxOpen, Kind: "collections"}
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE money_collections SET status = $2,
			closed_at = CASE WHEN $2 = 'closed' THEN now() END, updated_at = now() WHERE id = $1`, id, status); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetCollection(ctx, owner, id)
}

func (s *Store) DeleteCollection(ctx context.Context, owner string, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM money_collections WHERE id = $1 AND owner_id = $2`, id, owner)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) RotateCollectionLink(ctx context.Context, owner string, id uuid.UUID) (*Collection, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE money_collections SET share_token = $3, updated_at = now()
		WHERE id = $1 AND owner_id = $2`, id, owner, newToken())
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.GetCollection(ctx, owner, id)
}

// insertContribution adds a contribution to an open collection (locked), enforcing the per-collection cap.
func insertContribution(ctx context.Context, tx pgx.Tx, collectionID uuid.UUID, v *validContribution, source string) error {
	var status string
	var n int
	err := tx.QueryRow(ctx, `SELECT status, (SELECT count(*) FROM money_contributions WHERE collection_id = $1)
		FROM money_collections WHERE id = $1 FOR UPDATE`, collectionID).Scan(&status, &n)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if status != "open" {
		return ErrState
	}
	if n >= maxContributionsPerCollection {
		return invalid("This collection has reached its maximum number of contributions.")
	}
	_, err = tx.Exec(ctx, `INSERT INTO money_contributions (collection_id, name, phone, amount_cents, message,
		hide_name, hide_amount, status, method, source, sent_at, received_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
			CASE WHEN $8 IN ('sent', 'received') THEN now() END, CASE WHEN $8 = 'received' THEN now() END)`,
		collectionID, v.name, v.phone, v.cents, v.message, v.hideName, v.hideAmount, v.status, v.method, source)
	return err
}

// AddContribution is the organizer adding someone's contribution (e.g. cash in hand).
func (s *Store) AddContribution(ctx context.Context, owner string, id uuid.UUID, n NewContribution) (*Collection, error) {
	v, err := n.validate(true)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var ok bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM money_collections WHERE id = $1 AND owner_id = $2)`, id, owner).Scan(&ok); err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	if err := insertContribution(ctx, tx, id, v, "organizer"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetCollection(ctx, owner, id)
}

// SetContributionStatus lets the organizer mark a contribution pledged/sent/received.
func (s *Store) SetContributionStatus(ctx context.Context, owner string, id, contributionID uuid.UUID, status string) (*Collection, error) {
	if status != "pledged" && status != "sent" && status != "received" {
		return nil, invalid("status must be pledged, sent or received.")
	}
	tag, err := s.pool.Exec(ctx, `UPDATE money_contributions x SET status = $4,
			sent_at = CASE WHEN $4 = 'pledged' THEN NULL ELSE COALESCE(x.sent_at, now()) END,
			received_at = CASE WHEN $4 = 'received' THEN COALESCE(x.received_at, now()) END,
			updated_at = now()
		FROM money_collections c
		WHERE x.id = $3 AND x.collection_id = c.id AND c.id = $1 AND c.owner_id = $2`, id, owner, contributionID, status)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.GetCollection(ctx, owner, id)
}

// DeleteContribution removes a contribution (duplicate, spam, mistake).
func (s *Store) DeleteContribution(ctx context.Context, owner string, id, contributionID uuid.UUID) (*Collection, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM money_contributions x USING money_collections c
		WHERE x.id = $3 AND x.collection_id = c.id AND c.id = $1 AND c.owner_id = $2`, id, owner, contributionID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.GetCollection(ctx, owner, id)
}

// MarkReminded records that the organizer sent a reminder for a contribution.
func (s *Store) MarkReminded(ctx context.Context, owner string, id, contributionID uuid.UUID) (*Collection, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE money_contributions x SET last_reminded_at = now(),
			reminders_count = reminders_count + 1, updated_at = now()
		FROM money_collections c
		WHERE x.id = $3 AND x.collection_id = c.id AND c.id = $1 AND c.owner_id = $2`, id, owner, contributionID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.GetCollection(ctx, owner, id)
}

// ---------- public link ----------

// PublicContribution is what everyone with the link sees. Phones are never
// shown; hidden names and amounts are blanked out server-side.
type PublicContribution struct {
	Name        string    `json:"name"`         // "" when hidden
	AmountCents *int64    `json:"amount_cents"` // null when hidden
	Message     string    `json:"message"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

type PublicCollection struct {
	OwnerName     string               `json:"owner_name"`
	Kind          string               `json:"kind"`
	Title         string               `json:"title"`
	Beneficiary   string               `json:"beneficiary"`
	Description   string               `json:"description"`
	Currency      string               `json:"currency"`
	GoalCents     *int64               `json:"goal_cents"`
	Deadline      *Date                `json:"deadline"`
	ShowAmounts   bool                 `json:"show_amounts"`
	Status        string               `json:"status"`
	Totals        Totals               `json:"totals"`
	Contributions []PublicContribution `json:"contributions"`
}

func (s *Store) collectionByToken(ctx context.Context, token string) (*Collection, error) {
	if !validToken(token) {
		return nil, ErrNotFound
	}
	c, err := scanCollection(s.pool.QueryRow(ctx, `SELECT `+collectionCols+` FROM money_collections c
		WHERE c.share_token = $1`, token))
	if err != nil {
		return nil, err
	}
	c.Contributions, err = s.contributions(ctx, c.ID)
	return c, err
}

func publicView(c *Collection) *PublicCollection {
	out := &PublicCollection{
		OwnerName: c.OwnerName, Kind: c.Kind, Title: c.Title, Beneficiary: c.Beneficiary,
		Description: c.Description, Currency: c.Currency, GoalCents: c.GoalCents, Deadline: c.Deadline,
		ShowAmounts: c.ShowAmounts, Status: c.Status, Totals: c.Totals,
		Contributions: make([]PublicContribution, 0, len(c.Contributions)),
	}
	for _, x := range c.Contributions {
		p := PublicContribution{Message: x.Message, Status: x.Status, CreatedAt: x.CreatedAt}
		if !x.HideName {
			p.Name = x.Name
		}
		if c.ShowAmounts && !x.HideAmount {
			amount := x.AmountCents
			p.AmountCents = &amount
		}
		out.Contributions = append(out.Contributions, p)
	}
	return out
}

// PublicCollectionByToken loads the public view of a shared collection.
func (s *Store) PublicCollectionByToken(ctx context.Context, token string) (*PublicCollection, error) {
	c, err := s.collectionByToken(ctx, token)
	if err != nil {
		return nil, err
	}
	return publicView(c), nil
}

// Pledge adds a contribution through the public link.
func (s *Store) Pledge(ctx context.Context, token string, n NewContribution) (*PublicCollection, error) {
	v, err := n.validate(false)
	if err != nil {
		return nil, err
	}
	if !validToken(token) {
		return nil, ErrNotFound
	}
	var id uuid.UUID
	err = s.pool.QueryRow(ctx, `SELECT id FROM money_collections WHERE share_token = $1`, token).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := insertContribution(ctx, tx, id, v, "link"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.PublicCollectionByToken(ctx, token)
}
