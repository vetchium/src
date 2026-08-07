package adminapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	setConfigEnv(t)
	t.Setenv("ADMIN_SESSION_TTL", "12h")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TenantID != "sgp" || cfg.AdminSessionTTL != 12*time.Hour {
		t.Fatalf("config = %+v, want tenant sgp and TTL 12h", cfg)
	}
}

func TestLoadConfigRequiresAdminSessionTTL(t *testing.T) {
	setConfigEnv(t)
	t.Setenv("ADMIN_SESSION_TTL", "")

	if _, err := LoadConfig(); err == nil || !strings.Contains(err.Error(), "ADMIN_SESSION_TTL") {
		t.Fatalf("LoadConfig() error = %v, want ADMIN_SESSION_TTL error", err)
	}
}

func setConfigEnv(t *testing.T) {
	t.Helper()
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
	t.Setenv("PGSSLMODE", "disable")
}
