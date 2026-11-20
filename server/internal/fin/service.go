package fin

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("fin: not found")
	ErrInvalid  = errors.New("fin: invalid input")
)

// Categories that move money around rather than spend it: left out of "spent".
var notSpending = map[string]bool{"INCOME": true, "TRANSFER_IN": true, "TRANSFER_OUT": true, "LOAN_PAYMENTS": true}

const maxItemsPerUser = 10

type Service struct {
	pool  *pgxpool.Pool
	plaid *Plaid
	seal  *sealer
	now   func() time.Time
	// Right after connecting Plaid may not have the history yet: try again
	// every retryEvery, retryTimes times, in the background.
	retryEvery time.Duration
	retryTimes int
	notifier   Notifier // new alerts go here (push)
}

// New returns nil (AI Fin off) when plaid is nil. tokenKey encrypts access tokens.
func New(pool *pgxpool.Pool, plaid *Plaid, tokenKey string) (*Service, error) {
	if plaid == nil {
		return nil, nil
	}
	s, err := newSealer(tokenKey)
	if err != nil {
		return nil, err
	}
	return &Service{pool: pool, plaid: plaid, seal: s, now: time.Now, retryEvery: 10 * time.Second, retryTimes: 18}, nil
}

func (s *Service) Enabled() bool { return s != nil }

// ---------- connecting ----------

// LinkToken starts Plaid Link. With itemID it reopens that connection so the
// person can sign in to their bank again.
func (s *Service) LinkToken(ctx context.Context, user, lang, itemID string) (string, error) {
	access := ""
	if itemID != "" {
		it, err := s.item(ctx, user, itemID)
		if err != nil {
			return "", err
		}
		access = it.access
	} else {
		var n int
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM fin_items WHERE user_id = $1`, user).Scan(&n); err != nil {
			return "", err
		}
		if n >= maxItemsPerUser {
			return "", fmt.Errorf("%w: you can connect up to %d banks", ErrInvalid, maxItemsPerUser)
		}
	}
	return s.plaid.LinkToken(ctx, user, lang, access)
}

// Connect finishes Link: swaps the public token, saves the bank, and loads
// accounts and transactions.
func (s *Service) Connect(ctx context.Context, user, publicToken, institutionID, institutionName string) error {
	publicToken = strings.TrimSpace(publicToken)
	if publicToken == "" || len(publicToken) > 200 {
		return ErrInvalid
	}
	access, plaidItem, err := s.plaid.Exchange(ctx, publicToken)
	if err != nil {
		return err
	}
	name := strings.TrimSpace(institutionName)
	if len([]rune(name)) > 120 {
		name = string([]rune(name)[:120])
	}
	if len(institutionID) > 60 {
		institutionID = ""
	}
	id := uuid.New()
	_, err = s.pool.Exec(ctx, `INSERT INTO fin_items (id, user_id, plaid_item_id, access_token, institution_id, institution_name)
		VALUES ($1, $2, $3, $4, $5, $6)`, id, user, plaidItem, s.seal.seal(access), institutionID, name)
	if err != nil {
		return err
	}
	it := &item{id: id, user: user, access: access}
	if err := s.sync(ctx, it); err != nil {
		return err
	}
	if it.cursor == "" {
		go s.waitForHistory(it)
	}
	return nil
}

// waitForHistory syncs again until Plaid has the transaction history (it
// takes from seconds to a few minutes after connecting).
func (s *Service) waitForHistory(it *item) {
	for i := 0; i < s.retryTimes; i++ {
		time.Sleep(s.retryEvery)
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		err := s.sync(ctx, it)
		cancel()
		if err != nil {
			log.Printf("[FIN] waiting for history %s: %v", it.id, err)
		}
		if it.cursor != "" {
			return
		}
	}
}

// Refresh syncs every bank of the user that wasn't synced in the last minutes.
func (s *Service) Refresh(ctx context.Context, user string, olderThan time.Duration) error {
	items, err := s.items(ctx, user)
	if err != nil {
		return err
	}
	for _, it := range items {
		if olderThan > 0 && it.cursor != "" && it.syncedAt != nil && s.now().Sub(*it.syncedAt) < olderThan {
			continue
		}
		if err := s.sync(ctx, it); err != nil {
			log.Printf("[FIN] sync %s: %v", it.id, err)
		}
	}
	return nil
}

// Disconnect removes the bank from Plaid and deletes everything we stored.
func (s *Service) Disconnect(ctx context.Context, user, itemID string) error {
	it, err := s.item(ctx, user, itemID)
	if err != nil {
		return err
	}
	if err := s.plaid.RemoveItem(ctx, it.access); err != nil {
		log.Printf("[FIN] remove item at Plaid: %v", err) // delete our copy anyway
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM fin_items WHERE id = $1 AND user_id = $2`, it.id, user)
	return err
}

// ---------- syncing ----------

type item struct {
	id       uuid.UUID
	user     string
	access   string
	cursor   string
	syncedAt *time.Time
}

func (s *Service) items(ctx context.Context, user string) ([]*item, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, access_token, cursor, synced_at FROM fin_items WHERE user_id = $1 ORDER BY created_at`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*item
	for rows.Next() {
		it := &item{user: user}
		var box []byte
		if err := rows.Scan(&it.id, &box, &it.cursor, &it.syncedAt); err != nil {
			return nil, err
		}
		if it.access, err = s.seal.open(box); err != nil {
			return nil, fmt.Errorf("open access token: %w", err)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func (s *Service) item(ctx context.Context, user, id string) (*item, error) {
	uid, err := uuid.Parse(id)
	if err != nil {
		return nil, ErrNotFound
	}
	items, err := s.items(ctx, user)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		if it.id == uid {
			return it, nil
		}
	}
	return nil, ErrNotFound
}

func (s *Service) sync(ctx context.Context, it *item) error {
	added, err := s.syncItem(ctx, it)
	if needsRelink(err) {
		_, _ = s.pool.Exec(ctx, `UPDATE fin_items SET status = 'relink' WHERE id = $1`, it.id)
		return nil
	}
	if err != nil {
		return err
	}
	now := s.now().UTC()
	if err := s.checkAlerts(ctx, it.user, time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC), added); err != nil {
		log.Printf("[FIN] alerts for %s: %v", it.id, err)
	}
	return nil
}

func (s *Service) syncItem(ctx context.Context, it *item) ([]plaidTxn, error) {
	accounts, err := s.plaid.Accounts(ctx, it.access)
	if err != nil {
		return nil, err
	}
	// Pull every page of transaction changes first, then save in one go.
	cursor := it.cursor
	var added, modified []plaidTxn
	var removed []string
	for page := 0; page < 40; page++ {
		p, err := s.plaid.Sync(ctx, it.access, cursor)
		if err != nil {
			return nil, err
		}
		added = append(added, p.Added...)
		modified = append(modified, p.Modified...)
		for _, r := range p.Removed {
			removed = append(removed, r.TransactionID)
		}
		if p.UpdateStatus == "NOT_READY" && len(p.Added) == 0 {
			break // Plaid is still loading: keep the old cursor and try later
		}
		cursor = p.NextCursor
		if !p.HasMore {
			break
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	seen := make([]string, 0, len(accounts))
	for _, a := range accounts {
		seen = append(seen, a.AccountID)
		cur := a.Balances.Currency
		if cur == "" {
			cur = "USD"
		}
		typ := a.Type
		switch typ {
		case "depository", "credit", "loan", "investment":
		default:
			typ = "other"
		}
		_, err := tx.Exec(ctx, `INSERT INTO fin_accounts (id, item_id, user_id, plaid_account_id, name, official_name, mask, type, subtype,
				current_cents, available_cents, limit_cents, currency)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (plaid_account_id) DO UPDATE SET name = $5, official_name = $6, mask = $7, type = $8, subtype = $9,
				current_cents = $10, available_cents = $11, limit_cents = $12, currency = $13, updated_at = now()`,
			uuid.New(), it.id, it.user, a.AccountID, clip(a.Name, 120), clip(a.OfficialName, 160), clip(a.Mask, 8), typ, clip(a.Subtype, 40),
			centsPtr(a.Balances.Current), centsPtr(a.Balances.Available), centsPtr(a.Balances.Limit), cur)
		if err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM fin_accounts WHERE item_id = $1 AND NOT (plaid_account_id = ANY($2))`, it.id, seen); err != nil {
		return nil, err
	}
	for _, t := range append(added, modified...) {
		date, err := time.Parse("2006-01-02", t.Date)
		if err != nil {
			continue
		}
		cat := t.Category.Primary
		if cat == "" {
			cat = "OTHER"
		}
		cur := t.Currency
		if cur == "" {
			cur = "USD"
		}
		_, err = tx.Exec(ctx, `INSERT INTO fin_transactions (plaid_transaction_id, item_id, user_id, plaid_account_id, date, name,
				merchant_name, amount_cents, currency, category, category_detail, pending, logo_url)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (plaid_transaction_id) DO UPDATE SET plaid_account_id = $4, date = $5, name = $6, merchant_name = $7,
				amount_cents = $8, currency = $9, category = $10, category_detail = $11, pending = $12, logo_url = $13`,
			t.TransactionID, it.id, it.user, t.AccountID, date, clip(t.Name, 200), clip(t.MerchantName, 120), toCents(t.Amount), cur,
			clip(cat, 60), clip(t.Category.Detailed, 100), t.Pending, httpsOnly(t.LogoURL))
		if err != nil {
			return nil, err
		}
	}
	if len(removed) > 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM fin_transactions WHERE item_id = $1 AND plaid_transaction_id = ANY($2)`, it.id, removed); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE fin_items SET cursor = $2, synced_at = now(), status = 'ok' WHERE id = $1`, it.id, cursor); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	it.cursor = cursor
	return added, nil
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func httpsOnly(u string) string {
	if strings.HasPrefix(u, "https://") && len(u) <= 500 {
		return u
	}
	return ""
}

// ---------- reading ----------

type Account struct {
	ID             uuid.UUID `json:"id"`
	Name           string    `json:"name"`
	OfficialName   string    `json:"official_name"`
	Mask           string    `json:"mask"`
	Type           string    `json:"type"`
	Subtype        string    `json:"subtype"`
	CurrentCents   *int64    `json:"current_cents"`
	AvailableCents *int64    `json:"available_cents"`
	LimitCents     *int64    `json:"limit_cents"`
	Currency       string    `json:"currency"`
}

type Bank struct {
	ID              uuid.UUID  `json:"id"`
	InstitutionName string     `json:"institution_name"`
	Status          string     `json:"status"` // ok | relink
	SyncedAt        *time.Time `json:"synced_at"`
	Accounts        []Account  `json:"accounts"`
}

type Txn struct {
	ID          string    `json:"id"`
	AccountID   uuid.UUID `json:"account_id"`
	AccountName string    `json:"account_name"`
	Date        string    `json:"date"`
	Name        string    `json:"name"`
	Merchant    string    `json:"merchant"`
	AmountCents int64     `json:"amount_cents"` // positive = money out
	Currency    string    `json:"currency"`
	Category    string    `json:"category"`
	Pending     bool      `json:"pending"`
	LogoURL     string    `json:"logo_url"`
}

type CategorySpend struct {
	Category string `json:"category"`
	Cents    int64  `json:"cents"`
}

type Overview struct {
	Banks    []Bank `json:"banks"`
	Currency string `json:"currency"` // the main currency; totals below are in it
	// Net = what you have (cash, investments) − what you owe (cards, loans).
	NetCents        int64 `json:"net_cents"`
	CashCents       int64 `json:"cash_cents"`
	OwedCents       int64 `json:"owed_cents"`
	OtherCurrencies bool  `json:"other_currencies"` // some accounts are in another currency (left out of totals)
	Month           struct {
		Start          string          `json:"start"`
		SpentCents     int64           `json:"spent_cents"`
		IncomeCents    int64           `json:"income_cents"`
		LastMonthCents int64           `json:"last_month_cents"` // spent over the same days last month
		ByCategory     []CategorySpend `json:"by_category"`
	} `json:"month"`
	Recent []Txn `json:"recent"`
}

func (s *Service) Overview(ctx context.Context, user string, today time.Time) (*Overview, error) {
	o := &Overview{Banks: []Bank{}, Recent: []Txn{}}
	rows, err := s.pool.Query(ctx, `SELECT i.id, i.institution_name, i.status, i.synced_at,
			a.id, a.name, a.official_name, a.mask, a.type, a.subtype, a.current_cents, a.available_cents, a.limit_cents, a.currency
		FROM fin_items i LEFT JOIN fin_accounts a ON a.item_id = i.id
		WHERE i.user_id = $1 ORDER BY i.created_at, a.type, a.name`, user)
	if err != nil {
		return nil, err
	}
	byCurrency := map[string]int{}
	index := map[uuid.UUID]int{}
	for rows.Next() {
		var b Bank
		var aid *uuid.UUID
		var a Account
		var name, off, mask, typ, sub, cur *string
		if err := rows.Scan(&b.ID, &b.InstitutionName, &b.Status, &b.SyncedAt, &aid, &name, &off, &mask, &typ, &sub,
			&a.CurrentCents, &a.AvailableCents, &a.LimitCents, &cur); err != nil {
			rows.Close()
			return nil, err
		}
		i, ok := index[b.ID]
		if !ok {
			b.Accounts = []Account{}
			o.Banks = append(o.Banks, b)
			i = len(o.Banks) - 1
			index[b.ID] = i
		}
		if aid == nil {
			continue
		}
		a.ID, a.Name, a.OfficialName, a.Mask, a.Type, a.Subtype, a.Currency = *aid, *name, *off, *mask, *typ, *sub, *cur
		o.Banks[i].Accounts = append(o.Banks[i].Accounts, a)
		byCurrency[a.Currency]++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Main currency: the one most accounts use (USD when there are none).
	o.Currency = "USD"
	best := 0
	for c, n := range byCurrency {
		if n > best || (n == best && c == "USD") {
			o.Currency, best = c, n
		}
	}
	for _, b := range o.Banks {
		for _, a := range b.Accounts {
			if a.Currency != o.Currency {
				o.OtherCurrencies = true
				continue
			}
			if a.CurrentCents == nil {
				continue
			}
			switch a.Type {
			case "depository", "investment":
				o.CashCents += *a.CurrentCents
			case "credit", "loan":
				o.OwedCents += *a.CurrentCents
			}
		}
	}
	o.NetCents = o.CashCents - o.OwedCents

	start := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC)
	lastStart := start.AddDate(0, -1, 0)
	lastEnd := lastStart.AddDate(0, 0, today.Day()-1) // same number of days into last month
	if lastEnd.After(start.AddDate(0, 0, -1)) {
		lastEnd = start.AddDate(0, 0, -1)
	}
	o.Month.Start = start.Format("2006-01-02")
	o.Month.ByCategory = []CategorySpend{}
	cats, err := s.pool.Query(ctx, `SELECT category, sum(amount_cents)::bigint FROM fin_transactions
		WHERE user_id = $1 AND currency = $2 AND date >= $3 AND amount_cents > 0 AND NOT (category = ANY($4))
		GROUP BY category ORDER BY 2 DESC`, user, o.Currency, start, keys(notSpending))
	if err != nil {
		return nil, err
	}
	for cats.Next() {
		var c CategorySpend
		if err := cats.Scan(&c.Category, &c.Cents); err != nil {
			cats.Close()
			return nil, err
		}
		o.Month.SpentCents += c.Cents
		o.Month.ByCategory = append(o.Month.ByCategory, c)
	}
	cats.Close()
	err = s.pool.QueryRow(ctx, `SELECT
			coalesce(sum(-amount_cents) FILTER (WHERE date >= $3 AND category = 'INCOME' AND amount_cents < 0), 0)::bigint,
			coalesce(sum(amount_cents) FILTER (WHERE date >= $4 AND date <= $5 AND amount_cents > 0 AND NOT (category = ANY($6))), 0)::bigint
		FROM fin_transactions WHERE user_id = $1 AND currency = $2`,
		user, o.Currency, start, lastStart, lastEnd, keys(notSpending)).Scan(&o.Month.IncomeCents, &o.Month.LastMonthCents)
	if err != nil {
		return nil, err
	}
	o.Recent, err = s.Transactions(ctx, user, TxnQuery{Limit: 8})
	return o, err
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

type TxnQuery struct {
	AccountID string // our account id (optional)
	Category  string // Plaid primary category (optional)
	Search    string
	Limit     int
	Offset    int
}

func (s *Service) Transactions(ctx context.Context, user string, q TxnQuery) ([]Txn, error) {
	if q.Limit <= 0 || q.Limit > 100 {
		q.Limit = 50
	}
	if q.Offset < 0 || q.Offset > 10000 {
		q.Offset = 0
	}
	args := []any{user, q.Limit, q.Offset}
	where := "t.user_id = $1"
	if q.AccountID != "" {
		id, err := uuid.Parse(q.AccountID)
		if err != nil {
			return nil, ErrNotFound
		}
		args = append(args, id)
		where += fmt.Sprintf(" AND a.id = $%d", len(args))
	}
	if q.Category != "" {
		args = append(args, clip(q.Category, 60))
		where += fmt.Sprintf(" AND t.category = $%d", len(args))
	}
	if s := clip(q.Search, 60); s != "" {
		args = append(args, "%"+strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(s)+"%")
		where += fmt.Sprintf(" AND (t.name ILIKE $%d OR t.merchant_name ILIKE $%d)", len(args), len(args))
	}
	rows, err := s.pool.Query(ctx, `SELECT t.plaid_transaction_id, a.id, coalesce(a.name, ''), t.date, t.name, t.merchant_name,
			t.amount_cents, t.currency, t.category, t.pending, t.logo_url
		FROM fin_transactions t JOIN fin_accounts a ON a.plaid_account_id = t.plaid_account_id
		WHERE `+where+` ORDER BY t.date DESC, t.plaid_transaction_id LIMIT $2 OFFSET $3`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Txn, error) {
		var t Txn
		var d time.Time
		err := r.Scan(&t.ID, &t.AccountID, &t.AccountName, &d, &t.Name, &t.Merchant, &t.AmountCents, &t.Currency, &t.Category, &t.Pending, &t.LogoURL)
		t.Date = d.Format("2006-01-02")
		return t, err
	})
}
