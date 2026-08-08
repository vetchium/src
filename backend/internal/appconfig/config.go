// Package appconfig loads the shared, non-secret backend configuration.
package appconfig

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
	"time"
)

const defaultPath = "/etc/vetchium/config.json"

type Config struct {
	TenantID       string
	Env            Environment
	Database       Database
	Workers        Workers
	AdminAPIServer AdminAPIServer
	HubAPIServer   Server
	OrgsAPIServer  Server
	MCPServer      Server
}

type Environment string

const (
	EnvironmentDev        Environment = "dev"
	EnvironmentProduction Environment = "production"
	EnvironmentStaging    Environment = "staging"
)

type Database struct {
	Host         string
	Port         uint16
	User         string
	Name         string
	PasswordFile string
	SSLMode      string
}

type AdminAPIServer struct {
	AdminSessionTTL time.Duration
}

type Workers struct {
	RetryBackoffLimit       time.Duration
	PruneAdminSessionsTimer time.Duration
}

type Server struct{}

type fileConfig struct {
	TenantID       string              `json:"tenantId"`
	Env            string              `json:"env"`
	Database       fileDatabase        `json:"database"`
	Workers        fileWorkers         `json:"workers"`
	AdminAPIServer *fileAdminAPIServer `json:"admin-api-server"`
	HubAPIServer   *Server             `json:"hub-api-server"`
	OrgsAPIServer  *Server             `json:"orgs-api-server"`
	MCPServer      *Server             `json:"mcp-server"`
}

type fileDatabase struct {
	Host         string `json:"host"`
	Port         int    `json:"port"`
	User         string `json:"user"`
	Name         string `json:"name"`
	PasswordFile string `json:"passwordFile"`
	SSLMode      string `json:"sslMode"`
}

type fileAdminAPIServer struct {
	AdminSessionTTL string `json:"adminSessionTTL"`
}

type fileWorkers struct {
	RetryBackoffLimit       string `json:"retryBackoffLimit"`
	PruneAdminSessionsTimer string `json:"pruneAdminSessionsTimer"`
}

func Load() (Config, error) {
	path := os.Getenv("APP_CONFIG_FILE")
	if path == "" {
		path = defaultPath
	}
	config, err := LoadFile(path)
	if err != nil {
		return Config{}, err
	}

	// These overrides preserve the ability to use a database name and TLS mode
	// supplied by Compose. A Kubernetes ConfigMap can set both values directly
	// in the JSON and omit the overrides.
	if value := os.Getenv("PGDATABASE"); value != "" {
		config.Database.Name = value
	}
	if value := os.Getenv("PGSSLMODE"); value != "" {
		config.Database.SSLMode = value
	}
	return config, nil
}

func LoadFile(path string) (Config, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read application config %q: %w", path, err)
	}

	var raw fileConfig
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&raw); err != nil {
		return Config{}, fmt.Errorf("decode application config %q: %w", path, err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			err = fmt.Errorf("multiple JSON values")
		}
		return Config{}, fmt.Errorf("decode application config %q: %w", path, err)
	}

	if err := required("tenantId", raw.TenantID); err != nil {
		return Config{}, configError(path, err)
	}
	environment := Environment(raw.Env)
	switch environment {
	case EnvironmentDev, EnvironmentProduction, EnvironmentStaging:
	default:
		err := fmt.Errorf("env must be one of dev, production, staging")
		return Config{}, configError(path, err)
	}
	if err := required("database.host", raw.Database.Host); err != nil {
		return Config{}, configError(path, err)
	}
	if raw.Database.Port < 1 || raw.Database.Port > 65535 {
		err := fmt.Errorf("database.port must be between 1 and 65535")
		return Config{}, configError(path, err)
	}
	for name, value := range map[string]string{
		"database.user":         raw.Database.User,
		"database.name":         raw.Database.Name,
		"database.passwordFile": raw.Database.PasswordFile,
		"database.sslMode":      raw.Database.SSLMode,
	} {
		if err := required(name, value); err != nil {
			return Config{}, configError(path, err)
		}
	}

	if raw.AdminAPIServer == nil {
		err := fmt.Errorf("missing admin-api-server")
		return Config{}, configError(path, err)
	}
	if raw.HubAPIServer == nil {
		err := fmt.Errorf("missing hub-api-server")
		return Config{}, configError(path, err)
	}
	if raw.OrgsAPIServer == nil {
		err := fmt.Errorf("missing orgs-api-server")
		return Config{}, configError(path, err)
	}
	if raw.MCPServer == nil {
		err := fmt.Errorf("missing mcp-server")
		return Config{}, configError(path, err)
	}

	adminSessionTTL, err := positiveDuration(
		"admin-api-server.adminSessionTTL",
		raw.AdminAPIServer.AdminSessionTTL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	retryBackoffLimit, err := positiveDuration(
		"workers.retryBackoffLimit",
		raw.Workers.RetryBackoffLimit,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	pruneTimer, err := positiveDuration(
		"workers.pruneAdminSessionsTimer",
		raw.Workers.PruneAdminSessionsTimer,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}

	return Config{
		TenantID: raw.TenantID,
		Env:      environment,
		Database: Database{
			Host:         raw.Database.Host,
			Port:         uint16(raw.Database.Port),
			User:         raw.Database.User,
			Name:         raw.Database.Name,
			PasswordFile: raw.Database.PasswordFile,
			SSLMode:      raw.Database.SSLMode,
		},
		AdminAPIServer: AdminAPIServer{
			AdminSessionTTL: adminSessionTTL,
		},
		Workers: Workers{
			RetryBackoffLimit:       retryBackoffLimit,
			PruneAdminSessionsTimer: pruneTimer,
		},
		HubAPIServer:  Server{},
		OrgsAPIServer: Server{},
		MCPServer:     Server{},
	}, nil
}

func (d Database) URL() (string, error) {
	value, err := os.ReadFile(d.PasswordFile)
	if err != nil {
		return "", fmt.Errorf(
			"read database password file %q: %w",
			d.PasswordFile, err,
		)
	}
	password := strings.TrimRight(string(value), "\r\n")

	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(d.User, password),
		Host:   net.JoinHostPort(d.Host, strconv.Itoa(int(d.Port))),
		Path:   "/" + d.Name,
	}
	query := u.Query()
	query.Set("sslmode", d.SSLMode)
	u.RawQuery = query.Encode()
	return u.String(), nil
}

func required(name, value string) error {
	if value == "" {
		return fmt.Errorf("missing %s", name)
	}
	return nil
}

func positiveDuration(name, value string) (time.Duration, error) {
	if err := required(name, value); err != nil {
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

func configError(path string, err error) error {
	return fmt.Errorf("application config %q: %w", path, err)
}
