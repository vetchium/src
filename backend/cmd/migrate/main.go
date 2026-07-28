package main

import (
	"database/sql"
	"log"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL must be set")
	}

	migrationsDir := os.Getenv("MIGRATIONS_DIR")
	if migrationsDir == "" {
		migrationsDir = "/migrations/common" // default for docker image
	}

	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		log.Fatalf("goose: failed to open DB: %v\n", err)
	}
	defer db.Close()

	if err := goose.SetDialect("postgres"); err != nil {
		log.Fatalf("goose: failed to set dialect: %v\n", err)
	}

	if err := goose.Up(db, migrationsDir); err != nil {
		log.Fatalf("goose: up migrations failed: %v\n", err)
	}
	log.Println("Migrations applied successfully!")
}
