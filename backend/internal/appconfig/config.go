// Package appconfig loads the shared, non-secret backend configuration.
package appconfig

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultPath = "/etc/vetchium/config.json"
const defaultAdminCredentialKeyPath = "/run/secrets/admin_credential_key"
const defaultHubCredentialKeyPath = "/run/secrets/hub_credential_key"

type Config struct {
	TenantID          string
	Env               Environment
	Database          Database
	Workers           Workers
	AdminAPIServer    AdminAPIServer
	GlobalCoordinator GlobalCoordinator
	HubAPIServer      HubAPIServer
	SMTP              SMTP
	OrgsAPIServer     Server
	MCPServer         Server
}

type Environment string

const (
	EnvironmentCI         Environment = "ci"
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
	PruneEphemeralDataTimer time.Duration
	DeliverHubEmailTimer    time.Duration
	HubEmailLeaseTTL        time.Duration
	HubEmailMaxAttempts     int
}

type HubAPIServer struct {
	SessionTTL           time.Duration
	RememberedSessionTTL time.Duration
	PublicBaseURL        string
}

type SMTP struct {
	Host              string
	Port              uint16
	FromAddress       string
	FromName          string
	UsernameFile      string
	PasswordFile      string
	StartTLS          StartTLSMode
	ConnectionTimeout time.Duration
}

type StartTLSMode string

const (
	StartTLSDisabled      StartTLSMode = "disabled"
	StartTLSOpportunistic StartTLSMode = "opportunistic"
	StartTLSRequired      StartTLSMode = "required"
)

type GlobalCoordinator struct {
	BaseURL        string
	CredentialFile string
	RequestTimeout time.Duration
}

type Server struct{}

type fileConfig struct {
	TenantID          string                 `json:"tenantId"`
	Env               string                 `json:"env"`
	Database          fileDatabase           `json:"database"`
	Workers           fileWorkers            `json:"workers"`
	AdminAPIServer    *fileAdminAPIServer    `json:"admin-api-server"`
	GlobalCoordinator *fileGlobalCoordinator `json:"global-coordinator"`
	HubAPIServer      *fileHubAPIServer      `json:"hub-api-server"`
	SMTP              *fileSMTP              `json:"smtp"`
	OrgsAPIServer     *Server                `json:"orgs-api-server"`
	MCPServer         *Server                `json:"mcp-server"`
}

type fileGlobalCoordinator struct {
	BaseURL        string `json:"baseURL"`
	CredentialFile string `json:"credentialFile"`
	RequestTimeout string `json:"requestTimeout"`
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
	PruneEphemeralDataTimer string `json:"pruneEphemeralDataTimer"`
	DeliverHubEmailTimer    string `json:"deliverHubEmailTimer"`
	HubEmailLeaseTTL        string `json:"hubEmailLeaseTTL"`
	HubEmailMaxAttempts     int    `json:"hubEmailMaxAttempts"`
}

type fileHubAPIServer struct {
	SessionTTL           string `json:"sessionTTL"`
	RememberedSessionTTL string `json:"rememberedSessionTTL"`
	PublicBaseURL        string `json:"publicBaseURL"`
}

type fileSMTP struct {
	Host              string `json:"host"`
	Port              int    `json:"port"`
	FromAddress       string `json:"fromAddress"`
	FromName          string `json:"fromName"`
	UsernameFile      string `json:"usernameFile"`
	PasswordFile      string `json:"passwordFile"`
	StartTLS          string `json:"startTLS"`
	ConnectionTimeout string `json:"connectionTimeout"`
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
	case EnvironmentCI, EnvironmentDev, EnvironmentProduction,
		EnvironmentStaging:
	default:
		err := fmt.Errorf("env must be one of ci, dev, production, staging")
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
	if raw.SMTP == nil {
		err := fmt.Errorf("missing smtp")
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
	if raw.GlobalCoordinator == nil {
		err := fmt.Errorf("missing global-coordinator")
		return Config{}, configError(path, err)
	}
	coordinatorURL, err := url.Parse(raw.GlobalCoordinator.BaseURL)
	if err != nil || coordinatorURL.Scheme == "" || coordinatorURL.Host == "" ||
		(coordinatorURL.Scheme != "http" && coordinatorURL.Scheme != "https") ||
		coordinatorURL.User != nil || coordinatorURL.RawQuery != "" ||
		coordinatorURL.Fragment != "" {
		err := fmt.Errorf("global-coordinator.baseURL must be an HTTP(S) origin")
		return Config{}, configError(path, err)
	}
	if coordinatorURL.Path != "" && coordinatorURL.Path != "/" {
		err := fmt.Errorf("global-coordinator.baseURL must not contain a path")
		return Config{}, configError(path, err)
	}
	if err := required(
		"global-coordinator.credentialFile",
		raw.GlobalCoordinator.CredentialFile,
	); err != nil {
		return Config{}, configError(path, err)
	}
	coordinatorTimeout, err := positiveDuration(
		"global-coordinator.requestTimeout",
		raw.GlobalCoordinator.RequestTimeout,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}

	adminSessionTTL, err := positiveDuration(
		"admin-api-server.adminSessionTTL",
		raw.AdminAPIServer.AdminSessionTTL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	hubSessionTTL, err := positiveDuration(
		"hub-api-server.sessionTTL", raw.HubAPIServer.SessionTTL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	rememberedSessionTTL, err := positiveDuration(
		"hub-api-server.rememberedSessionTTL",
		raw.HubAPIServer.RememberedSessionTTL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	if rememberedSessionTTL <= hubSessionTTL {
		err := fmt.Errorf(
			"hub-api-server.rememberedSessionTTL must exceed sessionTTL",
		)
		return Config{}, configError(path, err)
	}
	hubBaseURL, err := httpOrigin(
		"hub-api-server.publicBaseURL", raw.HubAPIServer.PublicBaseURL,
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
	pruneEphemeralTimer, err := positiveDuration(
		"workers.pruneEphemeralDataTimer",
		raw.Workers.PruneEphemeralDataTimer,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	deliverHubEmailTimer, err := positiveDuration(
		"workers.deliverHubEmailTimer", raw.Workers.DeliverHubEmailTimer,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	hubEmailLeaseTTL, err := positiveDuration(
		"workers.hubEmailLeaseTTL", raw.Workers.HubEmailLeaseTTL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	if raw.Workers.HubEmailMaxAttempts < 1 ||
		raw.Workers.HubEmailMaxAttempts > 20 {
		err := fmt.Errorf("workers.hubEmailMaxAttempts must be between 1 and 20")
		return Config{}, configError(path, err)
	}
	smtp, err := parseSMTP(*raw.SMTP)
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
		GlobalCoordinator: GlobalCoordinator{
			BaseURL:        strings.TrimRight(coordinatorURL.String(), "/"),
			CredentialFile: raw.GlobalCoordinator.CredentialFile,
			RequestTimeout: coordinatorTimeout,
		},
		Workers: Workers{
			RetryBackoffLimit:       retryBackoffLimit,
			PruneAdminSessionsTimer: pruneTimer,
			PruneEphemeralDataTimer: pruneEphemeralTimer,
			DeliverHubEmailTimer:    deliverHubEmailTimer,
			HubEmailLeaseTTL:        hubEmailLeaseTTL,
			HubEmailMaxAttempts:     raw.Workers.HubEmailMaxAttempts,
		},
		HubAPIServer: HubAPIServer{
			SessionTTL:           hubSessionTTL,
			RememberedSessionTTL: rememberedSessionTTL,
			PublicBaseURL:        hubBaseURL,
		},
		SMTP:          smtp,
		OrgsAPIServer: Server{},
		MCPServer:     Server{},
	}, nil
}

func (c GlobalCoordinator) Credential() (string, error) {
	value, err := os.ReadFile(c.CredentialFile)
	if err != nil {
		return "", fmt.Errorf(
			"read global coordinator credential file %q: %w",
			c.CredentialFile, err,
		)
	}
	credential := strings.TrimRight(string(value), "\r\n")
	if len(credential) < 32 {
		return "", fmt.Errorf(
			"global coordinator credential file %q must contain at least 32 bytes",
			c.CredentialFile,
		)
	}
	return credential, nil
}

func (d Database) URL() (string, error) {
	password, err := d.Password()
	if err != nil {
		return "", err
	}

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

func (d Database) Password() (string, error) {
	value, err := os.ReadFile(d.PasswordFile)
	if err != nil {
		return "", fmt.Errorf(
			"read database password file %q: %w",
			d.PasswordFile, err,
		)
	}
	return strings.TrimRight(string(value), "\r\n"), nil
}

func AdminCredentialSecret() (string, error) {
	path := os.Getenv("ADMIN_CREDENTIAL_KEY_FILE")
	if path == "" {
		path = defaultAdminCredentialKeyPath
	}
	return credentialSecret("admin", path)
}

func HubCredentialSecret() (string, error) {
	path := os.Getenv("HUB_CREDENTIAL_KEY_FILE")
	if path == "" {
		path = defaultHubCredentialKeyPath
	}
	return credentialSecret("hub", path)
}

func credentialSecret(kind, path string) (string, error) {
	value, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf(
			"read %s credential key file %q: %w", kind, path, err,
		)
	}
	secret := strings.TrimRight(string(value), "\r\n")
	if secret == "" {
		return "", fmt.Errorf("%s credential key file %q is empty", kind, path)
	}
	return secret, nil
}

func (s SMTP) Credentials() (string, string, error) {
	if s.UsernameFile == "" {
		return "", "", nil
	}
	username, err := readTrimmedSecret("SMTP username", s.UsernameFile)
	if err != nil {
		return "", "", err
	}
	password, err := readTrimmedSecret("SMTP password", s.PasswordFile)
	if err != nil {
		return "", "", err
	}
	return username, password, nil
}

func readTrimmedSecret(kind, path string) (string, error) {
	value, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s file %q: %w", kind, path, err)
	}
	secret := strings.TrimRight(string(value), "\r\n")
	if secret == "" {
		return "", fmt.Errorf("%s file %q is empty", kind, path)
	}
	return secret, nil
}

func parseSMTP(raw fileSMTP) (SMTP, error) {
	if err := required("smtp.host", raw.Host); err != nil {
		return SMTP{}, err
	}
	if raw.Port < 1 || raw.Port > 65535 {
		return SMTP{}, fmt.Errorf("smtp.port must be between 1 and 65535")
	}
	if err := required("smtp.fromAddress", raw.FromAddress); err != nil {
		return SMTP{}, err
	}
	address, err := mail.ParseAddress(raw.FromAddress)
	if err != nil || address.Address != raw.FromAddress {
		return SMTP{}, fmt.Errorf("smtp.fromAddress must be a bare email address")
	}
	if err := required("smtp.fromName", raw.FromName); err != nil {
		return SMTP{}, err
	}
	if strings.ContainsAny(raw.FromName, "\r\n") {
		return SMTP{}, fmt.Errorf("smtp.fromName must not contain line breaks")
	}
	if (raw.UsernameFile == "") != (raw.PasswordFile == "") {
		return SMTP{}, fmt.Errorf(
			"smtp.usernameFile and smtp.passwordFile must both be set or empty",
		)
	}
	startTLS := StartTLSMode(raw.StartTLS)
	switch startTLS {
	case StartTLSDisabled, StartTLSOpportunistic, StartTLSRequired:
	default:
		return SMTP{}, fmt.Errorf(
			"smtp.startTLS must be disabled, opportunistic, or required",
		)
	}
	if raw.UsernameFile != "" && startTLS != StartTLSRequired {
		return SMTP{}, fmt.Errorf(
			"smtp.startTLS must be required when credentials are configured",
		)
	}
	timeout, err := positiveDuration(
		"smtp.connectionTimeout", raw.ConnectionTimeout,
	)
	if err != nil {
		return SMTP{}, err
	}
	return SMTP{
		Host: raw.Host, Port: uint16(raw.Port),
		FromAddress: raw.FromAddress, FromName: raw.FromName,
		UsernameFile: raw.UsernameFile, PasswordFile: raw.PasswordFile,
		StartTLS: startTLS, ConnectionTimeout: timeout,
	}, nil
}

func httpOrigin(name, value string) (string, error) {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Path != "" && parsed.Path != "/") {
		return "", fmt.Errorf("%s must be an HTTP(S) origin", name)
	}
	return strings.TrimRight(parsed.String(), "/"), nil
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
