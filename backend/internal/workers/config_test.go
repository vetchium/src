package workers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	setConfigEnv(t)
	t.Setenv("DELETE_EXPIRED_ADMIN_SESSIONS_INTERVAL", "15m")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TenantID != "sgp" || cfg.DeleteExpiredAdminSessionsInterval != 15*time.Minute {
		t.Fatalf("config = %+v, want tenant sgp and interval 15m", cfg)
	}
}

func TestLoadConfigRequiresDeleteExpiredAdminSessionsInterval(t *testing.T) {
	setConfigEnv(t)
	t.Setenv("DELETE_EXPIRED_ADMIN_SESSIONS_INTERVAL", "")

	if _, err := LoadConfig(); err == nil || !strings.Contains(err.Error(), "DELETE_EXPIRED_ADMIN_SESSIONS_INTERVAL") {
		t.Fatalf("LoadConfig() error = %v, want DELETE_EXPIRED_ADMIN_SESSIONS_INTERVAL error", err)
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
