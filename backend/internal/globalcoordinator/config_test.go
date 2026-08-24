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
  "env": "dev",
  "credentialFile": "/run/secrets/global_coordinator_credential",
  "stateFile": "/var/lib/vetchium-global-coordinator/last-id"
}`
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err := LoadConfigFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if config.Environment != "dev" || config.StateFile == "" ||
		config.CredentialFile == "" {
		t.Fatalf("config = %+v, want populated development config", config)
	}
}

func TestLoadConfigFileRejectsUnknownFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	contents := `{
  "env": "dev",
  "credentialFile": "/credential",
  "stateFile": "/state",
  "database": "forbidden"
}`
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadConfigFile(path)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("LoadConfigFile() error = %v, want unknown field error", err)
	}
}

func TestLoadCredential(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credential")
	if err := os.WriteFile(path, []byte(strings.Repeat("a", 32)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	credential, err := LoadCredential(path)
	if err != nil {
		t.Fatal(err)
	}
	if credential != strings.Repeat("a", 32) {
		t.Fatalf("credential = %q", credential)
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
