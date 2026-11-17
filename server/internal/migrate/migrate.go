// Package migrate applies the versioned SQL migrations in /migrations.
//
// Mayel'AI tracks applied versions in its own table (mayelai_migrations), so
// it can never be confused with another app's goose table in the same database.
package migrate

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"mayelai/server/migrations"
)

const table = "mayelai_migrations"

func withProvider(ctx context.Context, url string, fn func(*goose.Provider) error) error {
	if url == "" {
		return fmt.Errorf("DATABASE_URL is not set")
	}
	cfg, err := pgx.ParseConfig(url)
	if err != nil {
		return fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	db := stdlib.OpenDB(*cfg)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS, goose.WithTableName(table))
	if err != nil {
		return err
	}
	return fn(p)
}

// Up applies pending migrations and returns the resulting version.
func Up(ctx context.Context, url string) (version int64, err error) {
	err = withProvider(ctx, url, func(p *goose.Provider) error {
		if _, err := p.Up(ctx); err != nil {
			return err
		}
		version, err = p.GetDBVersion(ctx)
		return err
	})
	return version, err
}

// DownTo rolls back to version (0 = everything). Development/test databases only.
func DownTo(ctx context.Context, url string, version int64) error {
	return withProvider(ctx, url, func(p *goose.Provider) error {
		_, err := p.DownTo(ctx, version)
		return err
	})
}
