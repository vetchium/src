package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(passwordFile, []byte("p@ss/word\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("TENANT_ID", "sgp")
	t.Setenv("PGHOST", "db")
	t.Setenv("PGPORT", "5433")
	t.Setenv("PGUSER", "pguser")
	t.Setenv("PGDATABASE", "custom_db")
	t.Setenv("PGPASSWORD_FILE", passwordFile)

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TenantID != "sgp" {
		t.Fatalf("TenantID = %q, want sgp", cfg.TenantID)
	}
	for _, want := range []string{"pguser:p%40ss%2Fword", "db:5433", "/custom_db", "sslmode=disable"} {
		if !strings.Contains(cfg.DatabaseURL, want) {
			t.Errorf("DatabaseURL = %q, missing %q", cfg.DatabaseURL, want)
		}
	}
	if strings.Contains(cfg.DatabaseURL, "%0A") {
		t.Fatalf("DatabaseURL contains password-file newline: %q", cfg.DatabaseURL)
	}
}

func TestLoadUsesConfiguredSSLMode(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(passwordFile, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("TENANT_ID", "sgp")
	t.Setenv("PGHOST", "db")
	t.Setenv("PGPORT", "5432")
	t.Setenv("PGUSER", "pguser")
	t.Setenv("PGDATABASE", "tenant_db")
	t.Setenv("PGPASSWORD_FILE", passwordFile)
	t.Setenv("PGSSLMODE", "verify-full")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(cfg.DatabaseURL, "sslmode=verify-full") {
		t.Fatalf("DatabaseURL = %q, want configured sslmode", cfg.DatabaseURL)
	}
}

func TestLoadRequiresEverySetting(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(passwordFile, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}

	settings := map[string]string{
		"TENANT_ID":       "sgp",
		"PGHOST":          "db",
		"PGPORT":          "5432",
		"PGUSER":          "pguser",
		"PGDATABASE":      "tenant_db",
		"PGPASSWORD_FILE": passwordFile,
	}
	for missing := range settings {
		t.Run(missing, func(t *testing.T) {
			for key, value := range settings {
				t.Setenv(key, value)
			}
			t.Setenv(missing, "")

			if _, err := Load(); err == nil || !strings.Contains(err.Error(), missing) {
				t.Fatalf("Load() error = %v, want missing %s", err, missing)
			}
		})
	}
}

func TestLoadReportsUnreadablePasswordFile(t *testing.T) {
	t.Setenv("TENANT_ID", "sgp")
	t.Setenv("PGHOST", "db")
	t.Setenv("PGPORT", "5432")
	t.Setenv("PGUSER", "pguser")
	t.Setenv("PGDATABASE", "tenant_db")
	t.Setenv("PGPASSWORD_FILE", filepath.Join(t.TempDir(), "missing"))

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "read PGPASSWORD_FILE") {
		t.Fatalf("Load() error = %v, want password-file read error", err)
	}
}
