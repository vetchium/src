// Package envconfig provides small helpers used by command-local configuration.
package envconfig

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"
)

func TenantDatabase() (tenantID string, databaseURL string, err error) {
	tenantID, err = Required("TENANT_ID")
	if err != nil {
		return "", "", err
	}
	host, err := Required("PGHOST")
	if err != nil {
		return "", "", err
	}
	port, err := Required("PGPORT")
	if err != nil {
		return "", "", err
	}
	user, err := Required("PGUSER")
	if err != nil {
		return "", "", err
	}
	database, err := Required("PGDATABASE")
	if err != nil {
		return "", "", err
	}
	passwordFile, err := Required("PGPASSWORD_FILE")
	if err != nil {
		return "", "", err
	}
	sslMode, err := Required("PGSSLMODE")
	if err != nil {
		return "", "", err
	}

	value, err := os.ReadFile(passwordFile)
	if err != nil {
		return "", "", fmt.Errorf("read PGPASSWORD_FILE: %w", err)
	}
	password := strings.TrimRight(string(value), "\r\n")

	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(user, password),
		Host:   net.JoinHostPort(host, port),
		Path:   "/" + database,
	}
	query := u.Query()
	query.Set("sslmode", sslMode)
	u.RawQuery = query.Encode()
	return tenantID, u.String(), nil
}

func Required(name string) (string, error) {
	value := os.Getenv(name)
	if value == "" {
		return "", fmt.Errorf("missing %s", name)
	}
	return value, nil
}

func PositiveDuration(name string) (time.Duration, error) {
	value, err := Required(name)
	if err != nil {
		return 0, err
	}
	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", name, err)
	}
	if duration <= 0 {
		return 0, fmt.Errorf("%s must be positive", name)
	}
	return duration, nil
}
