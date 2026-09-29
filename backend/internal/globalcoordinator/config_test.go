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
  },
  "identityDigestKeyId": "909577e87ebd5395"
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

// The checked-in production file carries a placeholder the operator replaces
// with the computed key id (deploy/README.md). The coordinator must refuse
// the placeholder, and the file must be valid once it is replaced.
func TestCheckedInProductionConfigRequiresDigestKeyID(t *testing.T) {
	path := filepath.Join("..", "..", "..", "deploy", "global-coordinator", "config.json")
	_, err := LoadConfigFile(path)
	if err == nil || !strings.Contains(err.Error(), "identityDigestKeyId") {
		t.Fatalf("LoadConfigFile() error = %v, want identityDigestKeyId error", err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	const placeholder = "REPLACE_WITH_IDENTITY_DIGEST_KEY_ID_SEE_README"
	if !strings.Contains(string(contents), placeholder) {
		t.Fatalf("%s no longer holds the placeholder; update this test", path)
	}
	filled := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(filled, []byte(strings.Replace(
		string(contents), placeholder, "909577e87ebd5395", 1,
	)), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err := LoadConfigFile(filled)
	if err != nil {
		t.Fatal(err)
	}
	if config.Environment != "production" {
		t.Fatalf("environment = %q, want production", config.Environment)
	}
}

func TestLoadConfigFileRejectsMalformedDigestKeyID(t *testing.T) {
	for _, value := range []string{
		"", "909577e87ebd539", "909577E87EBD5395", "909577e87ebd53950",
	} {
		t.Run(value, func(t *testing.T) {
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
  "tls": {
    "certificateFile": "/server.crt",
    "keyFile": "/server.key",
    "clientCAFile": "/ca.crt",
    "healthCertificateFile": "/health.crt",
    "healthKeyFile": "/health.key",
    "healthServerName": "global-coordinator.mesh.vetchium.com"
  },
  "identityDigestKeyId": "` + value + `"
}`
			if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
				t.Fatal(err)
			}
			_, err := LoadConfigFile(path)
			if err == nil || !strings.Contains(err.Error(), "identityDigestKeyId") {
				t.Fatalf("LoadConfigFile() error = %v, want identityDigestKeyId error", err)
			}
		})
	}
}
