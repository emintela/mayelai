// Package auth verifies Clerk session tokens.
package auth

import (
	"context"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/jwt"
	"github.com/gofiber/fiber/v3"
)

const userIDKey = "clerkUserID"

// Clerk is a non-blocking middleware, like clerkMiddleware() from
// @clerk/express: if the request carries a valid Clerk session token
// (Authorization: Bearer <token> or the __session cookie), the user ID is
// stored on the context. Use Require to reject unauthenticated requests.
//
// If authorizedParties is non-empty, the token's azp claim (the origin the
// token was issued to, e.g. https://mayelai.com) must be one of them.
func Clerk(authorizedParties []string) fiber.Handler {
	params := jwt.VerifyParams{}
	if len(authorizedParties) > 0 {
		params.AuthorizedPartyHandler = func(azp string) bool {
			return slices.Contains(authorizedParties, azp)
		}
	}
	return func(c fiber.Ctx) error {
		token := strings.TrimPrefix(c.Get(fiber.HeaderAuthorization), "Bearer ")
		if token == "" {
			token = c.Cookies("__session")
		}
		if token != "" {
			p := params
			p.Token = token
			p.JWK = keys.get(c.Context(), token)
			claims, err := jwt.Verify(c.Context(), &p)
			if err == nil && claims.Subject != "" {
				SetUserID(c, claims.Subject)
			}
		}
		return c.Next()
	}
}

// Require rejects requests without a signed-in user.
func Require() fiber.Handler {
	return func(c fiber.Ctx) error {
		if UserID(c) == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
		}
		return c.Next()
	}
}

// UserID returns the authenticated Clerk user ID, or "" if unauthenticated.
func UserID(c fiber.Ctx) string {
	id, _ := c.Locals(userIDKey).(string)
	return id
}

// SetUserID marks the request as authenticated as id.
func SetUserID(c fiber.Ctx, id string) { c.Locals(userIDKey, id) }

// keyCache keeps Clerk's public signing keys in memory. Without it the Clerk
// SDK downloads them from Clerk's API on every request, which adds a network
// round trip to every API call.
type keyCache struct {
	mu   sync.Mutex
	keys map[string]cachedKey
}

type cachedKey struct {
	jwk     *clerk.JSONWebKey
	fetched time.Time
}

var keys = &keyCache{keys: map[string]cachedKey{}}

// get returns the key for the token's kid, or nil (Verify then fetches it itself).
func (k *keyCache) get(ctx context.Context, token string) *clerk.JSONWebKey {
	unverified, err := jwt.Decode(ctx, &jwt.DecodeParams{Token: token})
	if err != nil || unverified.KeyID == "" {
		return nil
	}
	k.mu.Lock()
	ck, ok := k.keys[unverified.KeyID]
	k.mu.Unlock()
	if ok && time.Since(ck.fetched) < time.Hour {
		return ck.jwk
	}
	jwk, err := jwt.GetJSONWebKey(ctx, &jwt.GetJSONWebKeyParams{KeyID: unverified.KeyID})
	if err != nil {
		return nil
	}
	k.mu.Lock()
	k.keys[unverified.KeyID] = cachedKey{jwk: jwk, fetched: time.Now()}
	k.mu.Unlock()
	return jwk
}
