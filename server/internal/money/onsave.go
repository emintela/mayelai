package money

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// onSave: the likelemba app. A signed-in person sees every group they
// organize or belong to (members are linked to accounts through user_id).

// MyGroup is a group as seen by one signed-in person. Organizers get the full
// view (phones, personal links, share link); members get the shared view.
type MyGroup struct {
	Group
	Role string  `json:"role"` // organizer | member
	You  *Member `json:"you"`  // the person's own membership, if any
}

func myView(g *Group, user string, owner bool) *MyGroup {
	out := &MyGroup{Group: *g, Role: "member"}
	if owner {
		out.Role = "organizer"
	} else {
		out.ShareToken = ""
		out.Members = make([]Member, len(g.Members))
		for i, m := range g.Members {
			out.Members[i] = Member{ID: m.ID, Name: m.Name, Position: m.Position, UserID: m.UserID}
		}
	}
	for i, m := range out.Members {
		if m.UserID != nil && *m.UserID == user {
			you := out.Members[i]
			if !owner {
				you.MemberToken = ""
			}
			out.You = &you
		}
	}
	return out
}

const myGroupWhere = `(g.owner_id = $1 OR EXISTS (SELECT 1 FROM money_group_members mm WHERE mm.group_id = g.id AND mm.user_id = $1))`

// MyGroups lists the groups the person organizes or belongs to, live ones first.
func (s *Store) MyGroups(ctx context.Context, user string) ([]MyGroup, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+groupCols+`, g.owner_id = $1 FROM money_groups g WHERE `+myGroupWhere+`
		ORDER BY (g.status IN ('forming', 'active')) DESC, g.created_at DESC LIMIT 100`, user)
	if err != nil {
		return nil, err
	}
	type item struct {
		g     *Group
		owner bool
	}
	var list []item
	for rows.Next() {
		var g Group
		var start *time.Time
		var owner bool
		if err := rows.Scan(&g.ID, &g.OwnerName, &g.Name, &g.Rules, &g.Currency, &g.AmountCents, &g.Frequency, &g.Status,
			&start, &g.ShareToken, &g.CreatedAt, &owner); err != nil {
			rows.Close()
			return nil, err
		}
		if start != nil {
			g.StartDate = &Date{*start}
		}
		list = append(list, item{&g, owner})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]MyGroup, 0, len(list))
	for _, it := range list {
		if err := s.loadGroup(ctx, it.g); err != nil {
			return nil, err
		}
		out = append(out, *myView(it.g, user, it.owner))
	}
	return out, nil
}

// MyGroup returns one group the person organizes or belongs to.
func (s *Store) MyGroup(ctx context.Context, user string, id uuid.UUID) (*MyGroup, error) {
	var owner bool
	row := s.pool.QueryRow(ctx, `SELECT `+groupCols+`, g.owner_id = $1 FROM money_groups g WHERE g.id = $2 AND `+myGroupWhere, user, id)
	var g Group
	var start *time.Time
	err := row.Scan(&g.ID, &g.OwnerName, &g.Name, &g.Rules, &g.Currency, &g.AmountCents, &g.Frequency, &g.Status,
		&start, &g.ShareToken, &g.CreatedAt, &owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if start != nil {
		g.StartDate = &Date{*start}
	}
	if err := s.loadGroup(ctx, &g); err != nil {
		return nil, err
	}
	return myView(&g, user, owner), nil
}

// PayAsMember records "I paid" for the person's own membership.
func (s *Store) PayAsMember(ctx context.Context, user string, id uuid.UUID, round int, method string) (*MyGroup, error) {
	method, err := cleanText(method, 40, "Method")
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var memberID uuid.UUID
	var status string
	err = tx.QueryRow(ctx, `SELECT m.id, g.status FROM money_groups g JOIN money_group_members m ON m.group_id = g.id
		WHERE g.id = $1 AND m.user_id = $2 FOR UPDATE OF g`, id, user).Scan(&memberID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if status != "active" {
		return nil, ErrState
	}
	if err := markSent(ctx, tx, id, memberID, round, method); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.MyGroup(ctx, user, id)
}

// ErrAlreadyLinked: the personal link belongs to another account, or the
// person is already a different member of this group.
var ErrAlreadyLinked = errors.New("money: member already linked")

func isUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

// ClaimMember links the member behind a personal link to the signed-in
// account (someone who joined without an account and signed up later).
// Claiming again with the same account is a no-op.
func (s *Store) ClaimMember(ctx context.Context, user, token, memberToken string) (uuid.UUID, error) {
	if !validToken(token) || !validToken(memberToken) {
		return uuid.Nil, ErrNotFound
	}
	var groupID uuid.UUID
	var linked *string
	err := s.pool.QueryRow(ctx, `SELECT g.id, m.user_id FROM money_groups g JOIN money_group_members m ON m.group_id = g.id
		WHERE g.share_token = $1 AND m.member_token = $2`, token, memberToken).Scan(&groupID, &linked)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	if linked != nil {
		if *linked == user {
			return groupID, nil
		}
		return uuid.Nil, ErrAlreadyLinked
	}
	tag, err := s.pool.Exec(ctx, `UPDATE money_group_members SET user_id = $3
		WHERE group_id = $1 AND member_token = $2 AND user_id IS NULL`, groupID, memberToken, user)
	if isUniqueViolation(err) {
		return uuid.Nil, ErrAlreadyLinked
	}
	if err != nil {
		return uuid.Nil, err
	}
	if tag.RowsAffected() == 0 {
		return uuid.Nil, ErrAlreadyLinked // claimed by someone else in between
	}
	return groupID, nil
}

// JoinAsUser adds the signed-in person to a forming group through its link.
// If they are already a member, it returns the group unchanged.
func (s *Store) JoinAsUser(ctx context.Context, user, token, name, phone string) (*MyGroup, error) {
	if !validToken(token) {
		return nil, ErrNotFound
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var id uuid.UUID
	var status string
	err = tx.QueryRow(ctx, `SELECT id, status FROM money_groups WHERE share_token = $1 FOR UPDATE`, token).Scan(&id, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var already bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM money_group_members WHERE group_id = $1 AND user_id = $2)`, id, user).Scan(&already); err != nil {
		return nil, err
	}
	if !already {
		if status != "forming" {
			return nil, ErrState
		}
		if _, err := addMember(ctx, tx, id, name, phone, "link", &user); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
	}
	return s.MyGroup(ctx, user, id)
}

// Event is one line of the activity feed.
type Event struct {
	Kind        string    `json:"kind"` // joined, sent, received, payout
	GroupID     uuid.UUID `json:"group_id"`
	GroupName   string    `json:"group_name"`
	Who         string    `json:"who"`
	You         bool      `json:"you"` // the event is about the person themselves
	Round       *int      `json:"round"`
	Method      string    `json:"method"`
	AmountCents int64     `json:"amount_cents"`
	Currency    string    `json:"currency"`
	At          time.Time `json:"at"`
}

// Activity returns recent events across the person's groups, newest first.
func (s *Store) Activity(ctx context.Context, user string, limit int) ([]Event, error) {
	rows, err := s.pool.Query(ctx, `
		WITH mine AS (
			SELECT g.id, g.name, g.currency, g.amount_cents,
				(SELECT count(*) FROM money_group_members c WHERE c.group_id = g.id) AS n
			FROM money_groups g WHERE `+myGroupWhere+`
		)
		SELECT kind, gid, gname, who, you, round, method, cents, currency, at FROM (
			SELECT 'joined' AS kind, mine.id AS gid, mine.name AS gname, m.name AS who, COALESCE(m.user_id = $1, false) AS you,
				NULL::int AS round, '' AS method, 0::bigint AS cents, mine.currency, m.created_at AS at
			FROM money_group_members m JOIN mine ON mine.id = m.group_id
			UNION ALL
			-- "I paid". When the organizer records a payment as received directly,
			-- both times come from the same now(), so equal times mean no "I paid".
			SELECT 'sent', mine.id, mine.name, m.name, COALESCE(m.user_id = $1, false), p.round, p.method, mine.amount_cents, mine.currency, p.sent_at
			FROM money_group_payments p JOIN money_group_members m ON m.id = p.member_id JOIN mine ON mine.id = p.group_id
			WHERE p.sent_at IS NOT NULL AND p.received_at IS DISTINCT FROM p.sent_at
			UNION ALL
			SELECT 'received', mine.id, mine.name, m.name, COALESCE(m.user_id = $1, false), p.round, p.method, mine.amount_cents, mine.currency, p.received_at
			FROM money_group_payments p JOIN money_group_members m ON m.id = p.member_id JOIN mine ON mine.id = p.group_id
			WHERE p.received_at IS NOT NULL
			UNION ALL
			SELECT 'payout', mine.id, mine.name, m.name, COALESCE(m.user_id = $1, false), po.round, '', mine.amount_cents * mine.n, mine.currency, po.paid_at
			FROM money_group_payouts po JOIN mine ON mine.id = po.group_id
			JOIN money_group_members m ON m.group_id = po.group_id AND m.position = po.round
		) e ORDER BY at DESC LIMIT $2`, user, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.Kind, &e.GroupID, &e.GroupName, &e.Who, &e.You, &e.Round, &e.Method, &e.AmountCents, &e.Currency, &e.At); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
