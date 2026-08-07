package envconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTenantDatabase(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(passwordFile, []byte("p@ss/word\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	setTenantDatabaseEnv(t, passwordFile)
	tenantID, databaseURL, err := TenantDatabase()
	if err != nil {
		t.Fatal(err)
	}
	if tenantID != "sgp" {
		t.Fatalf("tenantID = %q, want sgp", tenantID)
	}
	for _, want := range []string{"pguser:p%40ss%2Fword", "db:5433", "/custom_db", "sslmode=verify-full"} {
		if !strings.Contains(databaseURL, want) {
			t.Errorf("databaseURL = %q, missing %q", databaseURL, want)
		}
	}
	if strings.Contains(databaseURL, "%0A") {
		t.Fatalf("databaseURL contains password-file newline: %q", databaseURL)
	}
}

func TestTenantDatabaseRequiresEverySetting(t *testing.T) {
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
		"PGSSLMODE":       "disable",
	}
	for missing := range settings {
		t.Run(missing, func(t *testing.T) {
			for key, value := range settings {
				t.Setenv(key, value)
			}
			t.Setenv(missing, "")

			if _, _, err := TenantDatabase(); err == nil || !strings.Contains(err.Error(), missing) {
				t.Fatalf("TenantDatabase() error = %v, want missing %s", err, missing)
			}
		})
	}
}

func TestTenantDatabaseReportsUnreadablePasswordFile(t *testing.T) {
	setTenantDatabaseEnv(t, filepath.Join(t.TempDir(), "missing"))

	if _, _, err := TenantDatabase(); err == nil || !strings.Contains(err.Error(), "read PGPASSWORD_FILE") {
		t.Fatalf("TenantDatabase() error = %v, want password-file error", err)
	}
}

func TestPositiveDuration(t *testing.T) {
	t.Setenv("INTERVAL", "8h30m")

	got, err := PositiveDuration("INTERVAL")
	if err != nil {
		t.Fatal(err)
	}
	if want := 8*time.Hour + 30*time.Minute; got != want {
		t.Fatalf("PositiveDuration() = %s, want %s", got, want)
	}
}

func TestPositiveDurationRejectsMissingOrInvalidValue(t *testing.T) {
	for _, value := range []string{"", "forever", "0s", "-1h"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("INTERVAL", value)
			if _, err := PositiveDuration("INTERVAL"); err == nil || !strings.Contains(err.Error(), "INTERVAL") {
				t.Fatalf("PositiveDuration() error = %v, want INTERVAL error", err)
			}
		})
	}
}

func setTenantDatabaseEnv(t *testing.T, passwordFile string) {
	t.Helper()
	t.Setenv("TENANT_ID", "sgp")
	t.Setenv("PGHOST", "db")
	t.Setenv("PGPORT", "5433")
	t.Setenv("PGUSER", "pguser")
	t.Setenv("PGDATABASE", "custom_db")
	t.Setenv("PGPASSWORD_FILE", passwordFile)
	t.Setenv("PGSSLMODE", "verify-full")
}
