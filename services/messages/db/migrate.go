package db

import (
	"embed"
	"errors"
	"fmt"
	"log"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

// Embeber todo el contenido del directorio de migraciones en el binario
//go:embed migrations/*.sql
var migrationFiles embed.FS

func RunMigrations(databaseURL string) error {
	// Crear un driver de lectura a partir de los archivos embebidos
	sourceDriver, err := iofs.New(migrationFiles, "migrations")
	if err != nil {
		return fmt.Errorf("error creando driver de lectura: %w", err)
	}

	// Inicializar la instancia de migración
	m, err := migrate.NewWithSourceInstance("iofs", sourceDriver, databaseURL)
	if err != nil {
		return fmt.Errorf("error inicializando migración: %w", err)
	}
	defer m.Close()

	// Ejecutar las migraciones pendientes
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("error al ejecutar migraciones: %w", err)
	}

	log.Println("Migraciones ejecutadas exitosamente (o sin cambios pendientes).")
	return nil
}

// RollbackMigrations revierte 'steps' número de migraciones (ej. steps = 1)
func RollbackMigrations(databaseURL string, steps int) error {
	sourceDriver, err := iofs.New(migrationFiles, "migrations")
	if err != nil {
		return fmt.Errorf("error creando driver de lectura: %w", err)
	}

	m, err := migrate.NewWithSourceInstance("iofs", sourceDriver, databaseURL)
	if err != nil {
		return fmt.Errorf("error inicializando migración: %w", err)
	}
	defer m.Close()

	// Steps (-1) retrocede 1 migración. Con Steps(-N) retrocede N pasos.
	if err := m.Steps(-steps); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("error al revertir migración: %w", err)
	}

	log.Printf("Rollback exitoso de %d migración(es).\n", steps)
	return nil
}