package globalcoordinator

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

const defaultConfigPath = "/etc/vetchium/global-coordinator.json"

type Config struct {
	Environment    string
	CredentialFile string
	StateFile      string
}

type fileConfig struct {
	Environment    string `json:"env"`
	CredentialFile string `json:"credentialFile"`
	StateFile      string `json:"stateFile"`
}

func LoadConfig() (Config, error) {
	path := os.Getenv("GLOBAL_COORDINATOR_CONFIG_FILE")
	if path == "" {
		path = defaultConfigPath
	}
	return LoadConfigFile(path)
}

func LoadConfigFile(path string) (Config, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read global coordinator config %q: %w", path, err)
	}
	var raw fileConfig
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&raw); err != nil {
		return Config{}, fmt.Errorf("decode global coordinator config %q: %w", path, err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			err = fmt.Errorf("multiple JSON values")
		}
		return Config{}, fmt.Errorf("decode global coordinator config %q: %w", path, err)
	}
	if raw.Environment != "ci" && raw.Environment != "dev" &&
		raw.Environment != "production" && raw.Environment != "staging" {
		return Config{}, fmt.Errorf(
			"global coordinator config %q: env must be one of ci, dev, production, staging",
			path,
		)
	}
	if raw.CredentialFile == "" {
		return Config{}, fmt.Errorf(
			"global coordinator config %q: missing credentialFile", path,
		)
	}
	if raw.StateFile == "" {
		return Config{}, fmt.Errorf(
			"global coordinator config %q: missing stateFile", path,
		)
	}
	return Config(raw), nil
}

func LoadCredential(path string) (string, error) {
	value, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read global coordinator credential %q: %w", path, err)
	}
	credential := strings.TrimRight(string(value), "\r\n")
	if len(credential) < 32 {
		return "", fmt.Errorf(
			"global coordinator credential %q must contain at least 32 bytes", path,
		)
	}
	return credential, nil
}
