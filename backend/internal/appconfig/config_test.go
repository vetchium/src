package appconfig

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadFile(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(
		passwordFile, []byte("p@ss/word\n"), 0o600,
	); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadFile(writeConfig(t, passwordFile, ""))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TenantID != "sgp" || cfg.Env != EnvironmentDev ||
		cfg.AdminAPIServer.AdminSessionTTL != 24*time.Hour {
		t.Fatalf("config = %+v, want tenant sgp and admin-session TTL 24h", cfg)
	}
	if cfg.Workers.RetryBackoffLimit != 5*time.Minute ||
		cfg.Workers.PruneAdminSessionsTimer != time.Hour {
		t.Fatalf(
			"workers config = %+v, want retry limit 5m and prune interval 1h",
			cfg.Workers,
		)
	}

	databaseURL, err := cfg.Database.URL()
	if err != nil {
		t.Fatal(err)
	}
	wantedURLParts := []string{
		"pguser:p%40ss%2Fword", "db:5433",
		"/tenant_db", "sslmode=verify-full",
	}
	for _, want := range wantedURLParts {
		if !strings.Contains(databaseURL, want) {
			t.Errorf("database URL = %q, missing %q", databaseURL, want)
		}
	}
	if strings.Contains(databaseURL, "%0A") {
		t.Fatalf("database URL contains password-file newline: %q", databaseURL)
	}
}

func TestLoadUsesConfiguredPathAndDatabaseOverrides(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(passwordFile, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APP_CONFIG_FILE", writeConfig(t, passwordFile, ""))
	t.Setenv("PGDATABASE", "overridden_db")
	t.Setenv("PGSSLMODE", "require")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Database.Name != "overridden_db" || cfg.Database.SSLMode != "require" {
		t.Fatalf("database config = %+v, want deployment overrides", cfg.Database)
	}
}

func TestLoadFileRejectsUnknownFields(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := writeConfig(t, passwordFile, `,"pruneInterval":"1h"`)

	_, err := LoadFile(path)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("LoadFile() error = %v, want unknown field error", err)
	}
}

func TestLoadFileRejectsUnknownEnvironment(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := writeConfig(t, passwordFile, "")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	contents = []byte(strings.Replace(
		string(contents), `"env": "dev"`, `"env": "preview"`, 1,
	))
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = LoadFile(path)
	if err == nil || !strings.Contains(err.Error(), "env must be one of") {
		t.Fatalf("LoadFile() error = %v, want environment error", err)
	}
}

func TestLoadFileRequiresPositiveDurations(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := filepath.Join(t.TempDir(), "config.json")
	contents := fmt.Sprintf(`{
  "tenantId": "sgp",
  "env": "dev",
  "database": {
    "host": "db",
    "port": 5432,
    "user": "pguser",
    "name": "tenant_db",
    "passwordFile": %q,
    "sslMode": "disable"
  },
  "workers": {
    "retryBackoffLimit": "0s",
    "pruneAdminSessionsTimer": "1h"
  },
  "admin-api-server": {"adminSessionTTL": "24h"},
  "hub-api-server": {},
  "orgs-api-server": {},
  "mcp-server": {}
}`, passwordFile)
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := LoadFile(path)
	if err == nil || !strings.Contains(
		err.Error(), "workers.retryBackoffLimit must be positive",
	) {
		t.Fatalf("LoadFile() error = %v, want positive retry backoff error", err)
	}
}

func TestCheckedInConfigs(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	for _, region := range []string{"deu", "ind1", "sgp", "usa1"} {
		for _, test := range []struct {
			path string
			env  Environment
		}{
			{
				filepath.Join(root, "config", region+".json"),
				EnvironmentDev,
			},
			{
				filepath.Join(root, "deploy", region, "config.json"),
				EnvironmentProduction,
			},
		} {
			t.Run(test.path, func(t *testing.T) {
				cfg, err := LoadFile(test.path)
				if err != nil {
					t.Fatal(err)
				}
				if cfg.TenantID != region || cfg.Env != test.env {
					t.Fatalf(
						"config identifies tenant %q in %q, want tenant %q in %q",
						cfg.TenantID, cfg.Env, region, test.env,
					)
				}
			})
		}
	}
}

func writeConfig(t *testing.T, passwordFile, extraWorkerField string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	contents := fmt.Sprintf(`{
  "tenantId": "sgp",
  "env": "dev",
  "database": {
    "host": "db",
    "port": 5433,
    "user": "pguser",
    "name": "tenant_db",
    "passwordFile": %q,
    "sslMode": "verify-full"
  },
  "workers": {
    "retryBackoffLimit": "5m",
    "pruneAdminSessionsTimer": "1h"%s
  },
  "admin-api-server": {"adminSessionTTL": "24h"},
  "hub-api-server": {},
  "orgs-api-server": {},
  "mcp-server": {}
}`, passwordFile, extraWorkerField)
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
