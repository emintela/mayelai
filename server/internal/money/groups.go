package money

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Likelemba: rotating savings groups. With N members there are N rounds; in
// round k every member contributes AmountCents and the member at position k
// receives the pot (N × amount).

var Frequencies = map[string]bool{"weekly": true, "biweekly": true, "monthly": true}

const maxGroupMembers = 50

type Member struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Phone       *string   `json:"phone,omitempty"`        // organizer view only
	Position    int       `json:"position"`               // receives the pot in this round
	MemberToken string    `json:"member_token,omitempty"` // organizer view only (personal link)
	Source      string    `json:"source,omitempty"`
}

type RoundPayment struct {
	MemberID uuid.UUID `json:"member_id"`
	Status   string    `json:"status"` // sent, received (absent = not paid)
	Method   string    `json:"method"`
}

type Round struct {
	Number        int            `json:"number"`
	Date          Date           `json:"date"`
	RecipientID   uuid.UUID      `json:"recipient_id"`
	RecipientName string         `json:"recipient_name"`
	Payments      []RoundPayment `json:"payments"`
	ReceivedCount int            `json:"received_count"`
	SentCount     int            `json:"sent_count"`
	PaidOut       bool           `json:"paid_out"`
	PaidOutAt     *time.Time     `json:"paid_out_at"`
}

type Group struct {
	ID           uuid.UUID `json:"id"`
	OwnerName    string    `json:"owner_name"`
	Name         string    `json:"name"`
	Rules        string    `json:"rules"`
	Currency     string    `json:"currency"`
	AmountCents  int64     `json:"amount_cents"`
	Frequency    string    `json:"frequency"`
	Status       string    `json:"status"` // forming, active, completed, cancelled
	StartDate    *Date     `json:"start_date"`
	ShareToken   string    `json:"share_token,omitempty"`
	MemberCount  int       `json:"member_count"`
	PotCents     int64     `json:"pot_cents"`     // amount × members
	CurrentRound int       `json:"current_round"` // first round not paid out (0 while forming)
	CreatedAt    time.Time `json:"created_at"`
	Members      []Member  `json:"members"`
	Rounds       []Round   `json:"rounds"`
}

type NewGroup struct {
	OwnerName string `json:"owner_name"`
	Name      string `json:"name"`
	Rules     string `json:"rules"`
	Currency  string `json:"currency"`
	Amount    string `json:"amount"`
	Frequency string `json:"frequency"`
	// The organizer usually takes part too: add them as the first member.
	IncludeMe bool `json:"include_me"`
}

type GroupPatch struct {
	Name      *string `json:"name"`
	Rules     *string `json:"rules"`
	Amount    *string `json:"amount"`    // forming only
	Currency  *string `json:"currency"`  // forming only
	Frequency *string `json:"frequency"` // forming only
}

// RoundDate returns the date of round n (1-based): start + (n-1) periods.
// Monthly rounds keep the start day, clamped to the month's last day
// (a group starting on Jan 31 meets on Feb 28/29, Mar 31, Apr 30…).
func RoundDate(start time.Time, frequency string, n int) time.Time {
	k := n - 1
	switch frequency {
	case "weekly":
		return start.AddDate(0, 0, 7*k)
	case "biweekly":
		return start.AddDate(0, 0, 14*k)
	}
	y, m := start.Year(), int(start.Month())-1+k
	y += m / 12
	m = m%12 + 1
	last := time.Date(y, time.Month(m)+1, 0, 0, 0, 0, 0, time.UTC).Day()
	return time.Date(y, time.Month(m), min(start.Day(), last), 0, 0, 0, 0, time.UTC)
}

func newMemberToken() string { return newToken() }

// ---------- store: organizer ----------

const groupCols = `g.id, g.owner_name, g.name, g.rules, g.currency, g.amount_cents, g.frequency, g.status,
	g.start_date, g.share_token, g.created_at`

func scanGroup(row pgx.Row) (*Group, error) {
	var g Group
	var start *time.Time
	err := row.Scan(&g.ID, &g.OwnerName, &g.Name, &g.Rules, &g.Currency, &g.AmountCents, &g.Frequency, &g.Status,
		&start, &g.ShareToken, &g.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if start != nil {
		g.StartDate = &Date{*start}
	}
	return &g, nil
}

// load fills members, rounds and derived fields.
func (s *Store) loadGroup(ctx context.Context, g *Group) error {
	rows, err := s.pool.Query(ctx, `SELECT id, name, phone, position, member_token, source FROM money_group_members
		WHERE group_id = $1 ORDER BY position`, g.ID)
	if err != nil {
		return err
	}
	g.Members = []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.ID, &m.Name, &m.Phone, &m.Position, &m.MemberToken, &m.Source); err != nil {
			rows.Close()
			return err
		}
		g.Members = append(g.Members, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	g.MemberCount = len(g.Members)
	g.PotCents = g.AmountCents * int64(g.MemberCount)
	g.Rounds = []Round{}
	if g.StartDate == nil || g.Status == "forming" {
		return nil
	}

	payments := map[int][]RoundPayment{}
	rows, err = s.pool.Query(ctx, `SELECT round, member_id, status, method FROM money_group_payments WHERE group_id = $1`, g.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var round int
		var p RoundPayment
		if err := rows.Scan(&round, &p.MemberID, &p.Status, &p.Method); err != nil {
			rows.Close()
			return err
		}
		payments[round] = append(payments[round], p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	payouts := map[int]time.Time{}
	rows, err = s.pool.Query(ctx, `SELECT round, paid_at FROM money_group_payouts WHERE group_id = $1`, g.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var round int
		var at time.Time
		if err := rows.Scan(&round, &at); err != nil {
			rows.Close()
			return err
		}
		payouts[round] = at
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	g.CurrentRound = 0
	for i, m := range g.Members {
		n := i + 1
		r := Round{Number: n, Date: Date{RoundDate(g.StartDate.Time, g.Frequency, n)}, RecipientID: m.ID,
			RecipientName: m.Name, Payments: payments[n]}
		if r.Payments == nil {
			r.Payments = []RoundPayment{}
		}
		for _, p := range r.Payments {
			if p.Status == "received" {
				r.ReceivedCount++
			} else {
				r.SentCount++
			}
		}
		if at, ok := payouts[n]; ok {
			r.PaidOut, r.PaidOutAt = true, &at
		} else if g.CurrentRound == 0 {
			g.CurrentRound = n
		}
		g.Rounds = append(g.Rounds, r)
	}
	if g.CurrentRound == 0 {
		g.CurrentRound = len(g.Members) + 1 // all rounds paid out
	}
	return nil
}

func (s *Store) getOwned(ctx context.Context, owner string, id uuid.UUID) (*Group, error) {
	return scanGroup(s.pool.QueryRow(ctx, `SELECT `+groupCols+` FROM money_groups g WHERE g.id = $1 AND g.owner_id = $2`, id, owner))
}

// GetGroup returns one of the organizer's groups with members (phones, personal links) and rounds.
func (s *Store) GetGroup(ctx context.Context, owner string, id uuid.UUID) (*Group, error) {
	g, err := s.getOwned(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	return g, s.loadGroup(ctx, g)
}

func (s *Store) ListGroups(ctx context.Context, owner string) ([]Group, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+groupCols+` FROM money_groups g WHERE g.owner_id = $1
		ORDER BY (g.status IN ('forming', 'active')) DESC, g.created_at DESC LIMIT 100`, owner)
	if err != nil {
		return nil, err
	}
	var list []*Group
	for rows.Next() {
		g, err := scanGroup(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]Group, 0, len(list))
	for _, g := range list {
		if err := s.loadGroup(ctx, g); err != nil {
			return nil, err
		}
		out = append(out, *g)
	}
	return out, nil
}

func (n NewGroup) validate() (ownerName, name, rules, currency, frequency string, cents int64, err error) {
	if ownerName, err = cleanText(n.OwnerName, 80, "Your name"); err != nil {
		return
	}
	if name, err = cleanText(n.Name, 120, "Group name"); err != nil {
		return
	}
	if name == "" {
		err = invalid("Give the group a name.")
		return
	}
	if rules, err = cleanText(n.Rules, 1000, "Rules"); err != nil {
		return
	}
	currency = strings.ToUpper(strings.TrimSpace(n.Currency))
	if !Currencies[currency] {
		err = invalid("Currency must be USD, EUR or CAD.")
		return
	}
	if !Frequencies[n.Frequency] {
		err = invalid("Choose weekly, every two weeks or monthly.")
		return
	}
	frequency = n.Frequency
	if cents, err = ParseAmount(n.Amount); err != nil {
		return
	}
	if cents > 10_000_000 {
		err = invalid("The contribution is too large (maximum 100,000).")
	}
	return
}

// CreateGroup creates a forming group; maxActive > 0 caps forming+active groups.
func (s *Store) CreateGroup(ctx context.Context, owner string, n NewGroup, maxActive int) (*Group, error) {
	ownerName, name, rules, currency, frequency, cents, err := n.validate()
	if err != nil {
		return nil, err
	}
	if n.IncludeMe && ownerName == "" {
		return nil, invalid("Enter your name to join the group yourself.")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if maxActive > 0 {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('groups:' || $1))`, owner); err != nil {
			return nil, err
		}
		var open int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM money_groups WHERE owner_id = $1 AND status IN ('forming', 'active')`, owner).Scan(&open); err != nil {
			return nil, err
		}
		if open >= maxActive {
			return nil, &LimitError{Max: maxActive, Kind: "groups"}
		}
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `INSERT INTO money_groups (owner_id, owner_name, name, rules, currency, amount_cents, frequency, share_token)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		owner, ownerName, name, rules, currency, cents, frequency, newToken()).Scan(&id); err != nil {
		return nil, err
	}
	if n.IncludeMe {
		if _, err := tx.Exec(ctx, `INSERT INTO money_group_members (group_id, name, position, member_token, source)
			VALUES ($1, $2, 1, $3, 'organizer')`, id, ownerName, newMemberToken()); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetGroup(ctx, owner, id)
}

func (s *Store) UpdateGroup(ctx context.Context, owner string, id uuid.UUID, p GroupPatch) (*Group, error) {
	g, err := s.getOwned(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	if g.Status == "completed" || g.Status == "cancelled" {
		return nil, ErrState
	}
	if (p.Amount != nil || p.Currency != nil || p.Frequency != nil) && g.Status != "forming" {
		return nil, invalid("The amount, currency and frequency can't change after the group has started.")
	}
	name, rules, cur, freq, cents := g.Name, g.Rules, g.Currency, g.Frequency, g.AmountCents
	if p.Name != nil {
		if name, err = cleanText(*p.Name, 120, "Group name"); err != nil {
			return nil, err
		}
		if name == "" {
			return nil, invalid("Give the group a name.")
		}
	}
	if p.Rules != nil {
		if rules, err = cleanText(*p.Rules, 1000, "Rules"); err != nil {
			return nil, err
		}
	}
	if p.Currency != nil {
		cur = strings.ToUpper(*p.Currency)
		if !Currencies[cur] {
			return nil, invalid("Currency must be USD, EUR or CAD.")
		}
	}
	if p.Frequency != nil {
		if !Frequencies[*p.Frequency] {
			return nil, invalid("Choose weekly, every two weeks or monthly.")
		}
		freq = *p.Frequency
	}
	if p.Amount != nil {
		if cents, err = ParseAmount(*p.Amount); err != nil {
			return nil, err
		}
	}
	if _, err := s.pool.Exec(ctx, `UPDATE money_groups SET name = $3, rules = $4, currency = $5, frequency = $6,
		amount_cents = $7, updated_at = now() WHERE id = $1 AND owner_id = $2`, id, owner, name, rules, cur, freq, cents); err != nil {
		return nil, err
	}
	return s.GetGroup(ctx, owner, id)
}

// lockGroup locks the organizer's group row and returns its status.
func lockGroup(ctx context.Context, tx pgx.Tx, owner string, id uuid.UUID) (string, error) {
	var status string
	err := tx.QueryRow(ctx, `SELECT status FROM money_groups WHERE id = $1 AND owner_id = $2 FOR UPDATE`, id, owner).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return status, err
}

func addMember(ctx context.Context, tx pgx.Tx, groupID uuid.UUID, name, phone, source string) (string, error) {
	name, err := cleanText(name, 80, "Name")
	if err != nil {
		return "", err
	}
	if name == "" {
		return "", invalid("Enter a name.")
	}
	var ph *string
	if p := strings.TrimSpace(phone); p != "" {
		if !phoneRe.MatchString(p) {
			return "", invalid("Enter a valid phone number, for example +243 81 234 5678.")
		}
		ph = &p
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM money_group_members WHERE group_id = $1`, groupID).Scan(&n); err != nil {
		return "", err
	}
	if n >= maxGroupMembers {
		return "", invalid("A group can have at most 50 members.")
	}
	token := newMemberToken()
	_, err = tx.Exec(ctx, `INSERT INTO money_group_members (group_id, name, phone, position, member_token, source)
		VALUES ($1, $2, $3, $4, $5, $6)`, groupID, name, ph, n+1, token, source)
	return token, err
}

// AddMember adds someone while the group is forming.
func (s *Store) AddMember(ctx context.Context, owner string, id uuid.UUID, name, phone string) (*Group, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	status, err := lockGroup(ctx, tx, owner, id)
	if err != nil {
		return nil, err
	}
	if status != "forming" {
		return nil, invalid("Members can only be added before the group starts.")
	}
	if _, err := addMember(ctx, tx, id, name, phone, "organizer"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetGroup(ctx, owner, id)
}

// UpdateMember edits a member's name or phone (allowed at any time).
func (s *Store) UpdateMember(ctx context.Context, owner string, id, memberID uuid.UUID, name, phone *string) (*Group, error) {
	if _, err := s.getOwned(ctx, owner, id); err != nil {
		return nil, err
	}
	var n *string
	if name != nil {
		v, err := cleanText(*name, 80, "Name")
		if err != nil {
			return nil, err
		}
		if v == "" {
			return nil, invalid("Enter a name.")
		}
		n = &v
	}
	setPhone, newPhone := phone != nil, (*string)(nil)
	if phone != nil {
		if p := strings.TrimSpace(*phone); p != "" {
			if !phoneRe.MatchString(p) {
				return nil, invalid("Enter a valid phone number, for example +243 81 234 5678.")
			}
			newPhone = &p
		}
	}
	tag, err := s.pool.Exec(ctx, `UPDATE money_group_members SET name = COALESCE($3, name),
		phone = CASE WHEN $4 THEN $5 ELSE phone END WHERE id = $2 AND group_id = $1`, id, memberID, n, setPhone, newPhone)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.GetGroup(ctx, owner, id)
}

// RemoveMember removes someone before the group starts and closes the gap in the order.
func (s *Store) RemoveMember(ctx context.Context, owner string, id, memberID uuid.UUID) (*Group, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	status, err := lockGroup(ctx, tx, owner, id)
	if err != nil {
		return nil, err
	}
	if status != "forming" {
		return nil, invalid("Members can't be removed after the group has started.")
	}
	var pos int
	err = tx.QueryRow(ctx, `DELETE FROM money_group_members WHERE id = $2 AND group_id = $1 RETURNING position`, id, memberID).Scan(&pos)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE money_group_members SET position = position - 1 WHERE group_id = $1 AND position > $2`, id, pos); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetGroup(ctx, owner, id)
}

// SetOrder sets the payout order (all member IDs, first receives first). Forming only.
func (s *Store) SetOrder(ctx context.Context, owner string, id uuid.UUID, order []uuid.UUID) (*Group, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	status, err := lockGroup(ctx, tx, owner, id)
	if err != nil {
		return nil, err
	}
	if status != "forming" {
		return nil, invalid("The order can't change after the group has started.")
	}
	if err := applyOrder(ctx, tx, id, order); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetGroup(ctx, owner, id)
}

func applyOrder(ctx context.Context, tx pgx.Tx, groupID uuid.UUID, order []uuid.UUID) error {
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM money_group_members WHERE group_id = $1`, groupID).Scan(&n); err != nil {
		return err
	}
	seen := map[uuid.UUID]bool{}
	for _, m := range order {
		seen[m] = true
	}
	if len(order) != n || len(seen) != n {
		return invalid("The order must list every member exactly once.")
	}
	for i, m := range order {
		tag, err := tx.Exec(ctx, `UPDATE money_group_members SET position = $3 WHERE id = $2 AND group_id = $1`, groupID, m, i+1)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return invalid("The order must list every member exactly once.")
		}
	}
	return nil // positions are checked for uniqueness at commit (deferred constraint)
}

// DrawOrder shuffles the payout order fairly (crypto/rand). Forming only.
func (s *Store) DrawOrder(ctx context.Context, owner string, id uuid.UUID) (*Group, error) {
	g, err := s.GetGroup(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, len(g.Members))
	for i, m := range g.Members {
		ids[i] = m.ID
	}
	for i := len(ids) - 1; i > 0; i-- { // Fisher–Yates
		j, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return nil, err
		}
		ids[i], ids[j.Int64()] = ids[j.Int64()], ids[i]
	}
	return s.SetOrder(ctx, owner, id, ids)
}

// Start fixes the calendar: round 1 is on startDate. Needs at least 2 members.
func (s *Store) Start(ctx context.Context, owner string, id uuid.UUID, startDate string, today time.Time) (*Group, error) {
	d, err := ParseDate(startDate)
	if err != nil {
		return nil, err
	}
	if d.Before(today.AddDate(-1, 0, 0)) || d.After(today.AddDate(1, 0, 0)) {
		return nil, invalid("The first round must be within a year of today.")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	status, err := lockGroup(ctx, tx, owner, id)
	if err != nil {
		return nil, err
	}
	if status != "forming" {
		return nil, ErrState
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM money_group_members WHERE group_id = $1`, id).Scan(&n); err != nil {
		return nil, err
	}
	if n < 2 {
		return nil, invalid("A group needs at least 2 members to start.")
	}
	if _, err := tx.Exec(ctx, `UPDATE money_groups SET status = 'active', start_date = $2, updated_at = now() WHERE id = $1`, id, d.Time); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetGroup(ctx, owner, id)
}

// SetPayment records a member's contribution for a round: status "received",
// "sent" or "none" (clears it). Active groups only.
func (s *Store) SetPayment(ctx context.Context, owner string, id, memberID uuid.UUID, round int, status, method string) (*Group, error) {
	if status != "received" && status != "sent" && status != "none" {
		return nil, invalid("status must be received, sent or none.")
	}
	method, err := cleanText(method, 40, "Method")
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	gs, err := lockGroup(ctx, tx, owner, id)
	if err != nil {
		return nil, err
	}
	if gs != "active" {
		return nil, ErrState
	}
	if err := checkMemberRound(ctx, tx, id, memberID, round); err != nil {
		return nil, err
	}
	if status == "none" {
		_, err = tx.Exec(ctx, `DELETE FROM money_group_payments WHERE member_id = $1 AND round = $2`, memberID, round)
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO money_group_payments (group_id, member_id, round, status, method, sent_at, received_at)
			VALUES ($1, $2, $3, $4, $5, now(), CASE WHEN $4 = 'received' THEN now() END)
			ON CONFLICT (member_id, round) DO UPDATE SET status = EXCLUDED.status,
				method = CASE WHEN EXCLUDED.method <> '' THEN EXCLUDED.method ELSE money_group_payments.method END,
				received_at = CASE WHEN EXCLUDED.status = 'received' THEN COALESCE(money_group_payments.received_at, now()) END,
				updated_at = now()`, id, memberID, round, status, method)
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetGroup(ctx, owner, id)
}

func checkMemberRound(ctx context.Context, tx pgx.Tx, groupID, memberID uuid.UUID, round int) error {
	var n int
	var ok bool
	if err := tx.QueryRow(ctx, `SELECT count(*), bool_or(id = $2) FROM money_group_members WHERE group_id = $1`, groupID, memberID).Scan(&n, &ok); err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	if round < 1 || round > n {
		return invalid("That round doesn't exist.")
	}
	return nil
}

// SetPayout marks a round's pot as handed over (or undoes it). When every
// round is paid out the group completes; undoing reactivates it.
func (s *Store) SetPayout(ctx context.Context, owner string, id uuid.UUID, round int, paid bool) (*Group, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	status, err := lockGroup(ctx, tx, owner, id)
	if err != nil {
		return nil, err
	}
	if status != "active" && status != "completed" {
		return nil, ErrState
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM money_group_members WHERE group_id = $1`, id).Scan(&n); err != nil {
		return nil, err
	}
	if round < 1 || round > n {
		return nil, invalid("That round doesn't exist.")
	}
	if paid {
		_, err = tx.Exec(ctx, `INSERT INTO money_group_payouts (group_id, round) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, round)
	} else {
		_, err = tx.Exec(ctx, `DELETE FROM money_group_payouts WHERE group_id = $1 AND round = $2`, id, round)
	}
	if err != nil {
		return nil, err
	}
	var done int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM money_group_payouts WHERE group_id = $1`, id).Scan(&done); err != nil {
		return nil, err
	}
	next := "active"
	if done >= n {
		next = "completed"
	}
	if _, err := tx.Exec(ctx, `UPDATE money_groups SET status = $2, updated_at = now() WHERE id = $1`, id, next); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetGroup(ctx, owner, id)
}

// CancelGroup stops a forming or active group (history is kept).
func (s *Store) CancelGroup(ctx context.Context, owner string, id uuid.UUID) (*Group, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE money_groups SET status = 'cancelled', updated_at = now()
		WHERE id = $1 AND owner_id = $2 AND status IN ('forming', 'active')`, id, owner)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		if _, err := s.getOwned(ctx, owner, id); err != nil {
			return nil, err
		}
		return nil, ErrState
	}
	return s.GetGroup(ctx, owner, id)
}

func (s *Store) DeleteGroup(ctx context.Context, owner string, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM money_groups WHERE id = $1 AND owner_id = $2`, id, owner)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) RotateGroupLink(ctx context.Context, owner string, id uuid.UUID) (*Group, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE money_groups SET share_token = $3, updated_at = now() WHERE id = $1 AND owner_id = $2`,
		id, owner, newToken())
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.GetGroup(ctx, owner, id)
}

// ---------- public link ----------

// PublicGroup is the shared view: no phones, no personal links. You is set
// when the request carries a valid personal member token.
type PublicGroup struct {
	Group
	You *Member `json:"you"`
}

func publicGroup(g *Group, memberToken string) *PublicGroup {
	out := &PublicGroup{Group: *g}
	out.ShareToken = ""
	out.Members = make([]Member, len(g.Members))
	for i, m := range g.Members {
		out.Members[i] = Member{ID: m.ID, Name: m.Name, Position: m.Position}
		if memberToken != "" && m.MemberToken == memberToken {
			you := out.Members[i]
			out.You = &you
		}
	}
	return out
}

func (s *Store) groupByToken(ctx context.Context, token string) (*Group, error) {
	if !validToken(token) {
		return nil, ErrNotFound
	}
	g, err := scanGroup(s.pool.QueryRow(ctx, `SELECT `+groupCols+` FROM money_groups g WHERE g.share_token = $1`, token))
	if err != nil {
		return nil, err
	}
	return g, s.loadGroup(ctx, g)
}

// PublicGroupByToken returns the shared view; memberToken (optional) identifies "you".
func (s *Store) PublicGroupByToken(ctx context.Context, token, memberToken string) (*PublicGroup, error) {
	g, err := s.groupByToken(ctx, token)
	if err != nil {
		return nil, err
	}
	return publicGroup(g, memberToken), nil
}

// Join adds the visitor as a member while the group is forming and returns
// their personal token (to remember on their device).
func (s *Store) Join(ctx context.Context, token, name, phone string) (*PublicGroup, string, error) {
	if !validToken(token) {
		return nil, "", ErrNotFound
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, "", err
	}
	defer tx.Rollback(ctx)
	var id uuid.UUID
	var status string
	err = tx.QueryRow(ctx, `SELECT id, status FROM money_groups WHERE share_token = $1 FOR UPDATE`, token).Scan(&id, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	if status != "forming" {
		return nil, "", ErrState
	}
	memberToken, err := addMember(ctx, tx, id, name, phone, "link")
	if err != nil {
		return nil, "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, "", err
	}
	g, err := s.PublicGroupByToken(ctx, token, memberToken)
	return g, memberToken, err
}

// MemberSaysPaid lets a member mark their own contribution for a round as
// sent (it never overrides "received"; only the organizer confirms).
func (s *Store) MemberSaysPaid(ctx context.Context, token, memberToken string, round int, method string) (*PublicGroup, error) {
	if !validToken(token) || !validToken(memberToken) {
		return nil, ErrNotFound
	}
	method, err := cleanText(method, 40, "Method")
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var groupID, memberID uuid.UUID
	var status string
	err = tx.QueryRow(ctx, `SELECT g.id, m.id, g.status FROM money_groups g
		JOIN money_group_members m ON m.group_id = g.id
		WHERE g.share_token = $1 AND m.member_token = $2 FOR UPDATE OF g`, token, memberToken).Scan(&groupID, &memberID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if status != "active" {
		return nil, ErrState
	}
	if err := checkMemberRound(ctx, tx, groupID, memberID, round); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO money_group_payments (group_id, member_id, round, status, method, sent_at)
		VALUES ($1, $2, $3, 'sent', $4, now())
		ON CONFLICT (member_id, round) DO UPDATE SET method = CASE WHEN EXCLUDED.method <> '' THEN EXCLUDED.method ELSE money_group_payments.method END,
			updated_at = now()`, groupID, memberID, round, method); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.PublicGroupByToken(ctx, token, memberToken)
}
