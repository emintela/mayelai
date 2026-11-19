// Package fin is AI Fin: bank accounts people connect through Plaid
// (read-only balances and transactions), plus the overview the app shows.
package fin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"
)

// Plaid talks to Plaid's REST API.
type Plaid struct {
	clientID, secret, base string
	http                   *http.Client
}

// NewPlaid: env is "sandbox" (fake banks) or "production".
func NewPlaid(clientID, secret, env string) *Plaid {
	base := "https://sandbox.plaid.com"
	if env == "production" {
		base = "https://production.plaid.com"
	}
	return &Plaid{clientID: clientID, secret: secret, base: base, http: &http.Client{Timeout: 30 * time.Second}}
}

// WithBase points the client somewhere else (tests).
func (p *Plaid) WithBase(base string) *Plaid { p.base = base; return p }

// PlaidError is Plaid's error body.
type PlaidError struct {
	Status  int
	Type    string `json:"error_type"`
	Code    string `json:"error_code"`
	Message string `json:"error_message"`
}

func (e *PlaidError) Error() string {
	return fmt.Sprintf("plaid %d %s: %s", e.Status, e.Code, e.Message)
}

// needsRelink: the bank wants the person to sign in again through Link.
func needsRelink(err error) bool {
	var pe *PlaidError
	return errors.As(err, &pe) && (pe.Code == "ITEM_LOGIN_REQUIRED" || pe.Code == "PENDING_EXPIRATION")
}

func (p *Plaid) call(ctx context.Context, path string, body map[string]any, out any) error {
	body["client_id"], body["secret"] = p.clientID, p.secret
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.base+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		pe := &PlaidError{Status: resp.StatusCode}
		_ = json.Unmarshal(data, pe)
		return pe
	}
	return json.Unmarshal(data, out)
}

// LinkToken starts Plaid Link for one user. accessToken (optional) opens
// Link in update mode to fix a connection that needs a new sign-in.
func (p *Plaid) LinkToken(ctx context.Context, userID, lang, accessToken string) (string, error) {
	if lang != "fr" {
		lang = "en"
	}
	body := map[string]any{
		"client_name":   "Mayel'AI",
		"user":          map[string]string{"client_user_id": userID},
		"country_codes": []string{"US", "CA"},
		"language":      lang,
	}
	if accessToken != "" {
		body["access_token"] = accessToken
	} else {
		body["products"] = []string{"transactions"}
		body["transactions"] = map[string]int{"days_requested": 180}
	}
	var out struct {
		LinkToken string `json:"link_token"`
	}
	err := p.call(ctx, "/link/token/create", body, &out)
	return out.LinkToken, err
}

func (p *Plaid) Exchange(ctx context.Context, publicToken string) (accessToken, itemID string, err error) {
	var out struct {
		AccessToken string `json:"access_token"`
		ItemID      string `json:"item_id"`
	}
	err = p.call(ctx, "/item/public_token/exchange", map[string]any{"public_token": publicToken}, &out)
	return out.AccessToken, out.ItemID, err
}

type plaidAccount struct {
	AccountID    string `json:"account_id"`
	Name         string `json:"name"`
	OfficialName string `json:"official_name"`
	Mask         string `json:"mask"`
	Type         string `json:"type"`
	Subtype      string `json:"subtype"`
	Balances     struct {
		Current    *float64 `json:"current"`
		Available  *float64 `json:"available"`
		Limit      *float64 `json:"limit"`
		Currency   string   `json:"iso_currency_code"`
		Unofficial string   `json:"unofficial_currency_code"`
	} `json:"balances"`
}

// Accounts returns the accounts with the balances Plaid last saw.
func (p *Plaid) Accounts(ctx context.Context, accessToken string) ([]plaidAccount, error) {
	var out struct {
		Accounts []plaidAccount `json:"accounts"`
	}
	err := p.call(ctx, "/accounts/get", map[string]any{"access_token": accessToken}, &out)
	return out.Accounts, err
}

type plaidTxn struct {
	TransactionID string  `json:"transaction_id"`
	AccountID     string  `json:"account_id"`
	Date          string  `json:"date"`
	Name          string  `json:"name"`
	MerchantName  string  `json:"merchant_name"`
	Amount        float64 `json:"amount"`
	Currency      string  `json:"iso_currency_code"`
	Pending       bool    `json:"pending"`
	LogoURL       string  `json:"logo_url"`
	Category      struct {
		Primary  string `json:"primary"`
		Detailed string `json:"detailed"`
	} `json:"personal_finance_category"`
}

type syncPage struct {
	Added    []plaidTxn `json:"added"`
	Modified []plaidTxn `json:"modified"`
	Removed  []struct {
		TransactionID string `json:"transaction_id"`
	} `json:"removed"`
	NextCursor string `json:"next_cursor"`
	HasMore    bool   `json:"has_more"`
	// NOT_READY right after connecting, while Plaid is still loading the history.
	UpdateStatus string `json:"transactions_update_status"`
}

func (p *Plaid) Sync(ctx context.Context, accessToken, cursor string) (*syncPage, error) {
	body := map[string]any{"access_token": accessToken, "count": 500}
	if cursor != "" {
		body["cursor"] = cursor
	}
	var out syncPage
	err := p.call(ctx, "/transactions/sync", body, &out)
	return &out, err
}

func (p *Plaid) RemoveItem(ctx context.Context, accessToken string) error {
	var out struct{}
	return p.call(ctx, "/item/remove", map[string]any{"access_token": accessToken}, &out)
}

// SandboxPublicToken makes a test connection without Link (sandbox only; tests and demos).
func (p *Plaid) SandboxPublicToken(ctx context.Context, institutionID string) (string, error) {
	var out struct {
		PublicToken string `json:"public_token"`
	}
	err := p.call(ctx, "/sandbox/public_token/create", map[string]any{
		"institution_id": institutionID, "initial_products": []string{"transactions"},
	}, &out)
	return out.PublicToken, err
}

func toCents(v float64) int64 { return int64(math.Round(v * 100)) }

func centsPtr(v *float64) *int64 {
	if v == nil {
		return nil
	}
	c := toCents(*v)
	return &c
}
