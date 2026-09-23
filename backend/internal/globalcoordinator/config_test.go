package globalcoordinator

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadConfigFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	contents := `{
  "database": {
    "host": "global-db",
    "port": 5432,
    "user": "vetchium_app",
    "name": "global_db",
    "passwordFile": "/run/secrets/global_app_postgres_password",
    "sslMode": "disable"
  },
  "env": "dev",
  "signupRegionsFile": "/etc/vetchium/signup-regions.json",
  "tls": {
    "certificateFile": "/run/secrets/server.crt",
    "keyFile": "/run/secrets/server.key",
    "clientCAFile": "/run/secrets/ca.crt",
    "healthCertificateFile": "/run/secrets/health.crt",
    "healthKeyFile": "/run/secrets/health.key",
    "healthServerName": "global-coordinator.mesh.vetchium.com"
  }
}`
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err := LoadConfigFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if config.Environment != "dev" || config.SignupRegionsFile == "" ||
		config.Database.Host != "global-db" ||
		config.TLS.CertificateFile == "" {
		t.Fatalf("config = %+v, want populated development config", config)
	}
}

func TestLoadConfigFileRejectsUnknownFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	contents := `{
  "database": {
    "host": "global-db",
    "port": 5432,
    "user": "vetchium_app",
    "name": "global_db",
    "passwordFile": "/credential",
    "sslMode": "disable"
  },
  "env": "dev",
  "signupRegionsFile": "/regions",
  "forbidden": true
}`
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadConfigFile(path)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("LoadConfigFile() error = %v, want unknown field error", err)
	}
}

func TestDatabaseURL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(path, []byte("p@ssword\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	database := Database{
		Host: "global-db", Port: 5432, User: "vetchium_app",
		Name: "global_db", PasswordFile: path, SSLMode: "require",
	}
	databaseURL, err := database.URL()
	if err != nil {
		t.Fatal(err)
	}
	if databaseURL != "postgres://vetchium_app:p%40ssword@global-db:5432/global_db?sslmode=require" {
		t.Fatalf("URL() = %q", databaseURL)
	}
}

func TestCheckedInConfigs(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	for _, test := range []struct {
		path        string
		environment string
	}{
		{filepath.Join(root, "config", "global-coordinator.json"), "dev"},
		{filepath.Join(root, "config", "ci", "global-coordinator.json"), "ci"},
		{
			filepath.Join(root, "deploy", "global-coordinator", "config.json"),
			"production",
		},
	} {
		t.Run(test.path, func(t *testing.T) {
			config, err := LoadConfigFile(test.path)
			if err != nil {
				t.Fatal(err)
			}
			if config.Environment != test.environment {
				t.Fatalf("environment = %q, want %q", config.Environment, test.environment)
			}
		})
	}
}
