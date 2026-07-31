package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

const databaseName = "tenant_db"

type Config struct {
	TenantID    string
	DatabaseURL string
}

func Load() (Config, error) {
	tenantID := os.Getenv("TENANT_ID")
	if tenantID == "" {
		return Config{}, fmt.Errorf("missing TENANT_ID")
	}

	host := os.Getenv("PGHOST")
	if host == "" {
		return Config{}, fmt.Errorf("missing PGHOST")
	}
	port := os.Getenv("PGPORT")
	if port == "" {
		return Config{}, fmt.Errorf("missing PGPORT")
	}
	user := os.Getenv("PGUSER")
	if user == "" {
		return Config{}, fmt.Errorf("missing PGUSER")
	}
	passwordFile := os.Getenv("PGPASSWORD_FILE")
	if passwordFile == "" {
		return Config{}, fmt.Errorf("missing PGPASSWORD_FILE")
	}
	value, err := os.ReadFile(passwordFile)
	if err != nil {
		return Config{}, fmt.Errorf("read PGPASSWORD_FILE: %w", err)
	}
	password := strings.TrimRight(string(value), "\r\n")

	u := &url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(user, password),
		Host:     net.JoinHostPort(host, port),
		Path:     "/" + databaseName,
		RawQuery: "sslmode=disable",
	}

	return Config{TenantID: tenantID, DatabaseURL: u.String()}, nil
}
