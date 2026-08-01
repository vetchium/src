package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"
)

type Config struct {
	TenantID        string
	DatabaseURL     string
	AdminSessionTTL time.Duration
}

const defaultAdminSessionTTL = 24 * time.Hour

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
	database := os.Getenv("PGDATABASE")
	if database == "" {
		return Config{}, fmt.Errorf("missing PGDATABASE")
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
	sslMode := os.Getenv("PGSSLMODE")
	if sslMode == "" {
		sslMode = "disable"
	}

	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(user, password),
		Host:   net.JoinHostPort(host, port),
		Path:   "/" + database,
	}
	query := u.Query()
	query.Set("sslmode", sslMode)
	u.RawQuery = query.Encode()
	adminSessionTTL := defaultAdminSessionTTL
	if value := os.Getenv("ADMIN_SESSION_TTL"); value != "" {
		adminSessionTTL, err = time.ParseDuration(value)
		if err != nil {
			return Config{}, fmt.Errorf("parse ADMIN_SESSION_TTL: %w", err)
		}
		if adminSessionTTL <= 0 {
			return Config{}, fmt.Errorf("ADMIN_SESSION_TTL must be positive")
		}
	}

	return Config{
		TenantID:        tenantID,
		DatabaseURL:     u.String(),
		AdminSessionTTL: adminSessionTTL,
	}, nil
}
