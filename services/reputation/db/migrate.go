package db

import (
	"embed"
	"errors"
	"fmt"
	"log/slog"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// RunMigrations applies pending migrations to the database.
func RunMigrations(databaseURL string) error {
	sourceDriver, err := iofs.New(migrationFiles, "migrations")
	if err != nil {
		return fmt.Errorf("error creating migration source driver: %w", err)
	}

	m, err := migrate.NewWithSourceInstance("iofs", sourceDriver, databaseURL)
	if err != nil {
		return fmt.Errorf("error initializing migrations: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("error applying migrations: %w", err)
	}

	slog.Info("Database migrations applied successfully")
	return nil
}
