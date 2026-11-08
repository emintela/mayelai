// Package auth verifies Clerk session tokens.
package auth

import (
	"strings"

	"github.com/clerk/clerk-sdk-go/v2/jwt"
	"github.com/gofiber/fiber/v3"
)

const userIDKey = "clerkUserID"

// Clerk is a non-blocking middleware, like clerkMiddleware() from @clerk/express:
// if the request carries a valid session token (Authorization: Bearer <token>
// or the __session cookie), the user ID is stored on the context. Routes that
// require auth check UserID themselves.
func Clerk() fiber.Handler {
	return func(c fiber.Ctx) error {
		token := strings.TrimPrefix(c.Get(fiber.HeaderAuthorization), "Bearer ")
		if token == "" {
			token = c.Cookies("__session")
		}
		if token != "" {
			claims, err := jwt.Verify(c.Context(), &jwt.VerifyParams{Token: token})
			if err == nil && claims.Subject != "" {
				c.Locals(userIDKey, claims.Subject)
			}
		}
		return c.Next()
	}
}

// UserID returns the authenticated Clerk user ID, or "" if unauthenticated.
func UserID(c fiber.Ctx) string {
	id, _ := c.Locals(userIDKey).(string)
	return id
}
