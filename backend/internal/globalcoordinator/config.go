package globalcoordinator

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"

	directoryspec "github.com/vetchium/src/typespec/directory"
)

const defaultConfigPath = "/etc/vetchium/global-coordinator.json"

type Config struct {
	Environment string
	Database    Database
	TLS         TLS
	// IdentityDigestKeyID identifies the shared secret every tenant's
	// hub-api and workers derive their identitydigest.Key from. The
	// coordinator never holds that secret; it only compares this id against
	// the one each directory request carries, to reject a tenant
	// misconfigured with a different secret (GU-KEY-004) instead of
	// silently breaking global email uniqueness.
	IdentityDigestKeyID string
}

type TLS struct {
	CertificateFile       string `json:"certificateFile"`
	KeyFile               string `json:"keyFile"`
	ClientCAFile          string `json:"clientCAFile"`
	HealthCertificateFile string `json:"healthCertificateFile"`
	HealthKeyFile         string `json:"healthKeyFile"`
	HealthServerName      string `json:"healthServerName"`
}

type Database struct {
	Host         string `json:"host"`
	Port         uint16 `json:"port"`
	User         string `json:"user"`
	Name         string `json:"name"`
	PasswordFile string `json:"passwordFile"`
	SSLMode      string `json:"sslMode"`
}

type fileConfig struct {
	Environment         string   `json:"env"`
	Database            Database `json:"database"`
	TLS                 TLS      `json:"tls"`
	IdentityDigestKeyID string   `json:"identityDigestKeyId"`
}

func LoadConfig() (Config, error) {
	path := os.Getenv("GLOBAL_COORDINATOR_CONFIG_FILE")
	if path == "" {
		path = defaultConfigPath
	}
	config, err := LoadConfigFile(path)
	if err != nil {
		return Config{}, err
	}
	if value := os.Getenv("PGDATABASE"); value != "" {
		config.Database.Name = value
	}
	if value := os.Getenv("PGSSLMODE"); value != "" {
		config.Database.SSLMode = value
	}
	return config, nil
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
	if raw.Database.Host == "" || raw.Database.User == "" ||
		raw.Database.Name == "" || raw.Database.PasswordFile == "" ||
		raw.Database.SSLMode == "" {
		return Config{}, fmt.Errorf(
			"global coordinator config %q: database fields must not be empty", path,
		)
	}
	if raw.Database.Port == 0 {
		return Config{}, fmt.Errorf(
			"global coordinator config %q: database.port must be between 1 and 65535",
			path,
		)
	}
	if raw.TLS.CertificateFile == "" || raw.TLS.KeyFile == "" ||
		raw.TLS.ClientCAFile == "" || raw.TLS.HealthCertificateFile == "" ||
		raw.TLS.HealthKeyFile == "" || raw.TLS.HealthServerName == "" {
		return Config{}, fmt.Errorf(
			"global coordinator config %q: TLS fields must not be empty", path,
		)
	}
	// The checked-in production file holds a placeholder until the operator
	// computes the id (deploy/README.md); starting with it would reject every
	// digest-bearing directory request while still reporting healthy.
	if !directoryspec.IsDigestKeyID(directoryspec.DigestKeyID(raw.IdentityDigestKeyID)) {
		return Config{}, fmt.Errorf(
			"global coordinator config %q: identityDigestKeyId must be the 16 lowercase hex characters of the identity digest key id",
			path,
		)
	}
	return Config(raw), nil
}

func (d Database) URL() (string, error) {
	password, err := os.ReadFile(d.PasswordFile)
	if err != nil {
		return "", fmt.Errorf(
			"read global database password file %q: %w", d.PasswordFile, err,
		)
	}
	value := strings.TrimRight(string(password), "\r\n")
	if value == "" {
		return "", fmt.Errorf("global database password file %q is empty", d.PasswordFile)
	}
	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(d.User, value),
		Host:   net.JoinHostPort(d.Host, strconv.Itoa(int(d.Port))),
		Path:   "/" + d.Name,
	}
	query := u.Query()
	query.Set("sslmode", d.SSLMode)
	u.RawQuery = query.Encode()
	return u.String(), nil
}
