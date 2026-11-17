// Package migrations holds Mayel'AI's versioned SQL schema (goose format).
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
