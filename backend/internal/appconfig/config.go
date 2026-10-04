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
	"slices"
	"strconv"
	"strings"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
	orgsubscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/regions"
)

const defaultPath = "/etc/vetchium/config.json"
const defaultAdminCredentialKeyPath = "/run/secrets/admin_credential_key"
const defaultHubCredentialKeyPath = "/run/secrets/hub_credential_key"
const defaultOrgsCredentialKeyPath = "/run/secrets/orgs_credential_key"
const defaultIdentityDigestKeyPath = "/run/secrets/identity_digest_key"

type Config struct {
	SignupRegionsFile     string
	TenantID              string
	Env                   Environment
	Database              Database
	Workers               Workers
	AdminAPIServer        AdminAPIServer
	GlobalCoordinator     GlobalCoordinator
	MeshAPIServer         MeshAPIServer
	HubAPIServer          HubAPIServer
	ObjectStorage         ObjectStorage
	SMTP                  SMTP
	OrgsAPIServer         OrgsAPIServer
	OrgDomainVerification OrgDomainVerification
	OrgBilling            OrgBilling
	MCPServer             Server
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
	SessionTTL time.Duration
}

type Workers struct {
	RetryBackoffLimit            time.Duration
	PruneAdminSessionsTimer      time.Duration
	PruneEphemeralDataTimer      time.Duration
	DeliverHubEmailTimer         time.Duration
	HubEmailLeaseTTL             time.Duration
	HubEmailMaxAttempts          int
	AdvanceHubSubscriptionsTimer time.Duration
	ReconcileHubSignupTimer      time.Duration
	ReconcileHubEmailChangeTimer time.Duration
	DeliverOrgEmailTimer         time.Duration
	OrgEmailLeaseTTL             time.Duration
	OrgEmailMaxAttempts          int
	ReconcileOrgSignupTimer      time.Duration
	VerifyOrgDomainsTimer        time.Duration
}

type HubAPIServer struct {
	Signup               regions.Admission
	SessionTTL           time.Duration
	RememberedSessionTTL time.Duration
	PublicBaseURL        string
	OfferedPlans         []subscriptionspec.Plan
}

type OrgsAPIServer struct {
	Signup        regions.Admission
	SessionTTL    time.Duration
	SignupTTL     time.Duration
	InvitationTTL time.Duration
	PublicBaseURL string
	// GoogleSignIn is nil when the tenant does not offer Google sign-in.
	GoogleSignIn *GoogleSignIn
}

// GoogleSignIn is the tenant's OAuth client at Google. DiscoveryURL is set
// only where the provider is reached at a different address than the one it
// signs into tokens, which is true of the development mock behind Docker
// networks and never of Google.
type GoogleSignIn struct {
	Issuer           string
	DiscoveryURL     string
	ClientID         string
	ClientSecretFile string
	RedirectURI      string
}

func (g GoogleSignIn) ClientSecret() (string, error) {
	return readTrimmedSecret("Google OIDC client secret", g.ClientSecretFile)
}

// OrgBilling sets which Org plans a tenant offers.
type OrgBilling struct {
	OfferedPlans []orgsubscriptionspec.Plan
}

// OrgDomainVerification sets how Org domain TXT records are looked up and how
// the re-verification lifecycle in agent-guides/orgs.md is timed.
type OrgDomainVerification struct {
	// ResolverAddress is the only resolver queried; there is no fallback to
	// the system resolver.
	ResolverAddress    string
	LookupTimeout      time.Duration
	CheckInterval      time.Duration
	FailureThreshold   int
	FailingGracePeriod time.Duration
	InconclusiveRetry  time.Duration
	InconclusiveLimit  time.Duration
}

type ObjectStorage struct {
	PrivateBaseURL string
	MediaBaseURL   string
	AccessKeyFile  string
	SecretKeyFile  string
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

// GlobalCoordinator is the mesh API's mutually authenticated link to the
// coordinator. No other tenant process may dial the coordinator.
type GlobalCoordinator struct {
	BaseURL        string
	RequestTimeout time.Duration
	TLS            MeshClientTLS
}

type MeshClientTLS struct {
	CertificateFile string
	KeyFile         string
	CAFile          string
	ServerName      string
}

type MeshServerTLS struct {
	CertificateFile string
	KeyFile         string
	ClientCAFile    string
}

// MeshAPIServer is this tenant's own mesh API: the origin hub-api dials for
// region discovery, and the credential both sides of that hop present. A
// compromised hub-api therefore cannot reach the coordinator or another
// tenant's mesh.
type MeshAPIServer struct {
	BaseURL        string
	CredentialFile string
	RequestTimeout time.Duration
	PeerAddress    string
	PeerTLS        MeshServerTLS
}

type Server struct{}

type fileConfig struct {
	SignupRegionsFile     string                     `json:"signupRegionsFile"`
	TenantID              string                     `json:"tenantId"`
	Env                   string                     `json:"env"`
	Database              fileDatabase               `json:"database"`
	Workers               fileWorkers                `json:"workers"`
	AdminAPIServer        *fileAdminAPIServer        `json:"adminAPIServer"`
	GlobalCoordinator     *fileGlobalCoordinator     `json:"globalCoordinator"`
	MeshAPIServer         *fileMeshAPIServer         `json:"meshAPIServer"`
	HubAPIServer          *fileHubAPIServer          `json:"hubAPIServer"`
	ObjectStorage         *fileObjectStorage         `json:"objectStorage"`
	SMTP                  *fileSMTP                  `json:"smtp"`
	OrgsAPIServer         *fileOrgsAPIServer         `json:"orgsAPIServer"`
	OrgDomainVerification *fileOrgDomainVerification `json:"orgDomainVerification"`
	OrgBilling            *fileOrgBilling            `json:"orgBilling"`
	MCPServer             *Server                    `json:"mcpServer"`
}

type fileGlobalCoordinator struct {
	BaseURL        string            `json:"baseURL"`
	RequestTimeout string            `json:"requestTimeout"`
	TLS            fileMeshClientTLS `json:"tls"`
}

type fileMeshClientTLS struct {
	CertificateFile string `json:"certificateFile"`
	KeyFile         string `json:"keyFile"`
	CAFile          string `json:"caFile"`
	ServerName      string `json:"serverName"`
}

type fileMeshAPIServer struct {
	BaseURL        string            `json:"baseURL"`
	CredentialFile string            `json:"credentialFile"`
	RequestTimeout string            `json:"requestTimeout"`
	PeerAddress    string            `json:"peerAddress"`
	PeerTLS        fileMeshServerTLS `json:"peerTLS"`
}

type fileMeshServerTLS struct {
	CertificateFile string `json:"certificateFile"`
	KeyFile         string `json:"keyFile"`
	ClientCAFile    string `json:"clientCAFile"`
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
	SessionTTL string `json:"sessionTTL"`
}

type fileWorkers struct {
	RetryBackoffLimit            string `json:"retryBackoffLimit"`
	PruneAdminSessionsTimer      string `json:"pruneAdminSessionsTimer"`
	PruneEphemeralDataTimer      string `json:"pruneEphemeralDataTimer"`
	DeliverHubEmailTimer         string `json:"deliverHubEmailTimer"`
	HubEmailLeaseTTL             string `json:"hubEmailLeaseTTL"`
	HubEmailMaxAttempts          int    `json:"hubEmailMaxAttempts"`
	AdvanceHubSubscriptionsTimer string `json:"advanceHubSubscriptionsTimer"`
	ReconcileHubSignupTimer      string `json:"reconcileHubSignupTimer"`
	ReconcileHubEmailChangeTimer string `json:"reconcileHubEmailChangeTimer"`
	DeliverOrgEmailTimer         string `json:"deliverOrgEmailTimer"`
	OrgEmailLeaseTTL             string `json:"orgEmailLeaseTTL"`
	OrgEmailMaxAttempts          int    `json:"orgEmailMaxAttempts"`
	ReconcileOrgSignupTimer      string `json:"reconcileOrgSignupTimer"`
	VerifyOrgDomainsTimer        string `json:"verifyOrgDomainsTimer"`
}

type fileHubAPIServer struct {
	Signup               *regions.Admission `json:"signup"`
	SessionTTL           string             `json:"sessionTTL"`
	RememberedSessionTTL string             `json:"rememberedSessionTTL"`
	PublicBaseURL        string             `json:"publicBaseURL"`
	OfferedPlans         []string           `json:"offeredPlans"`
}

type fileOrgsAPIServer struct {
	Signup        *regions.Admission `json:"signup"`
	SessionTTL    string             `json:"sessionTTL"`
	SignupTTL     string             `json:"signupTTL"`
	InvitationTTL string             `json:"invitationTTL"`
	PublicBaseURL string             `json:"publicBaseURL"`
	GoogleSignIn  *fileGoogleSignIn  `json:"googleSignIn"`
}

type fileGoogleSignIn struct {
	Issuer           string `json:"issuer"`
	DiscoveryURL     string `json:"discoveryURL"`
	ClientID         string `json:"clientID"`
	ClientSecretFile string `json:"clientSecretFile"`
	RedirectURI      string `json:"redirectURI"`
}

type fileOrgBilling struct {
	OfferedPlans []string `json:"offeredPlans"`
}

type fileOrgDomainVerification struct {
	ResolverAddress    string `json:"resolverAddress"`
	LookupTimeout      string `json:"lookupTimeout"`
	CheckInterval      string `json:"checkInterval"`
	FailureThreshold   int    `json:"failureThreshold"`
	FailingGracePeriod string `json:"failingGracePeriod"`
	InconclusiveRetry  string `json:"inconclusiveRetry"`
	InconclusiveLimit  string `json:"inconclusiveLimit"`
}

type fileObjectStorage struct {
	PrivateBaseURL string `json:"privateBaseURL"`
	MediaBaseURL   string `json:"mediaBaseURL"`
	AccessKeyFile  string `json:"accessKeyFile"`
	SecretKeyFile  string `json:"secretKeyFile"`
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
		err := fmt.Errorf("missing adminAPIServer")
		return Config{}, configError(path, err)
	}
	if raw.HubAPIServer == nil {
		err := fmt.Errorf("missing hubAPIServer")
		return Config{}, configError(path, err)
	}
	if raw.ObjectStorage == nil {
		return Config{}, configError(path, fmt.Errorf("missing objectStorage"))
	}
	if raw.SMTP == nil {
		err := fmt.Errorf("missing smtp")
		return Config{}, configError(path, err)
	}
	if raw.OrgsAPIServer == nil {
		err := fmt.Errorf("missing orgsAPIServer")
		return Config{}, configError(path, err)
	}
	if raw.OrgDomainVerification == nil {
		err := fmt.Errorf("missing orgDomainVerification")
		return Config{}, configError(path, err)
	}
	if raw.OrgBilling == nil {
		err := fmt.Errorf("missing orgBilling")
		return Config{}, configError(path, err)
	}
	if raw.MCPServer == nil {
		err := fmt.Errorf("missing mcpServer")
		return Config{}, configError(path, err)
	}
	if raw.GlobalCoordinator == nil {
		err := fmt.Errorf("missing globalCoordinator")
		return Config{}, configError(path, err)
	}
	if raw.MeshAPIServer == nil {
		err := fmt.Errorf("missing meshAPIServer")
		return Config{}, configError(path, err)
	}
	// Every tenant program loads the region catalog from this path and refuses
	// to start without it, so an absent setting is a configuration error rather
	// than something to discover at boot.
	if err := required(
		"signupRegionsFile", raw.SignupRegionsFile,
	); err != nil {
		return Config{}, configError(path, err)
	}
	coordinatorURL, err := url.Parse(raw.GlobalCoordinator.BaseURL)
	if err != nil || coordinatorURL.Scheme == "" || coordinatorURL.Host == "" ||
		coordinatorURL.Scheme != "https" ||
		coordinatorURL.User != nil || coordinatorURL.RawQuery != "" ||
		coordinatorURL.Fragment != "" {
		err := fmt.Errorf("globalCoordinator.baseURL must be an HTTPS origin")
		return Config{}, configError(path, err)
	}
	if coordinatorURL.Path != "" && coordinatorURL.Path != "/" {
		err := fmt.Errorf("globalCoordinator.baseURL must not contain a path")
		return Config{}, configError(path, err)
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{"globalCoordinator.tls.certificateFile", raw.GlobalCoordinator.TLS.CertificateFile},
		{"globalCoordinator.tls.keyFile", raw.GlobalCoordinator.TLS.KeyFile},
		{"globalCoordinator.tls.caFile", raw.GlobalCoordinator.TLS.CAFile},
		{"globalCoordinator.tls.serverName", raw.GlobalCoordinator.TLS.ServerName},
	} {
		if err := required(field.name, field.value); err != nil {
			return Config{}, configError(path, err)
		}
	}
	coordinatorTimeout, err := positiveDuration(
		"globalCoordinator.requestTimeout",
		raw.GlobalCoordinator.RequestTimeout,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}

	meshBaseURL, err := httpOrigin(
		"meshAPIServer.baseURL", raw.MeshAPIServer.BaseURL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	if err := required(
		"meshAPIServer.credentialFile", raw.MeshAPIServer.CredentialFile,
	); err != nil {
		return Config{}, configError(path, err)
	}
	meshTimeout, err := positiveDuration(
		"meshAPIServer.requestTimeout", raw.MeshAPIServer.RequestTimeout,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	if _, err := net.ResolveTCPAddr("tcp", raw.MeshAPIServer.PeerAddress); err != nil {
		return Config{}, configError(path, fmt.Errorf(
			"meshAPIServer.peerAddress must be a TCP listen address: %w", err,
		))
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{"meshAPIServer.peerTLS.certificateFile", raw.MeshAPIServer.PeerTLS.CertificateFile},
		{"meshAPIServer.peerTLS.keyFile", raw.MeshAPIServer.PeerTLS.KeyFile},
		{"meshAPIServer.peerTLS.clientCAFile", raw.MeshAPIServer.PeerTLS.ClientCAFile},
	} {
		if err := required(field.name, field.value); err != nil {
			return Config{}, configError(path, err)
		}
	}

	adminSessionTTL, err := positiveDuration(
		"adminAPIServer.sessionTTL",
		raw.AdminAPIServer.SessionTTL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	admission := regions.Admission{Enabled: true}
	if raw.HubAPIServer.Signup != nil {
		admission = *raw.HubAPIServer.Signup
	}
	hubSessionTTL, err := positiveDuration(
		"hubAPIServer.sessionTTL", raw.HubAPIServer.SessionTTL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	rememberedSessionTTL, err := positiveDuration(
		"hubAPIServer.rememberedSessionTTL",
		raw.HubAPIServer.RememberedSessionTTL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	if rememberedSessionTTL <= hubSessionTTL {
		err := fmt.Errorf(
			"hubAPIServer.rememberedSessionTTL must exceed sessionTTL",
		)
		return Config{}, configError(path, err)
	}
	hubBaseURL, err := httpOrigin(
		"hubAPIServer.publicBaseURL", raw.HubAPIServer.PublicBaseURL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	offeredPlans, err := parseOfferedPlans(raw.HubAPIServer.OfferedPlans)
	if err != nil {
		return Config{}, configError(path, err)
	}
	orgsAPIServer, err := parseOrgsAPIServer(*raw.OrgsAPIServer)
	if err != nil {
		return Config{}, configError(path, err)
	}
	orgDomainVerification, err := parseOrgDomainVerification(
		*raw.OrgDomainVerification,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	orgBilling, err := parseOrgBilling(*raw.OrgBilling)
	if err != nil {
		return Config{}, configError(path, err)
	}
	privateObjectURL, err := httpOrigin(
		"objectStorage.privateBaseURL", raw.ObjectStorage.PrivateBaseURL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	mediaURL, err := httpOrigin(
		"objectStorage.mediaBaseURL", raw.ObjectStorage.MediaBaseURL,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	if (environment == EnvironmentProduction || environment == EnvironmentStaging) &&
		!strings.HasPrefix(mediaURL, "https://") {
		return Config{}, configError(path, fmt.Errorf(
			"objectStorage.mediaBaseURL must use HTTPS outside development and CI",
		))
	}
	if err := required("objectStorage.accessKeyFile", raw.ObjectStorage.AccessKeyFile); err != nil {
		return Config{}, configError(path, err)
	}
	if err := required("objectStorage.secretKeyFile", raw.ObjectStorage.SecretKeyFile); err != nil {
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
	advanceHubSubscriptionsTimer, err := positiveDuration(
		"workers.advanceHubSubscriptionsTimer",
		raw.Workers.AdvanceHubSubscriptionsTimer,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	reconcileHubSignupTimer, err := positiveDuration(
		"workers.reconcileHubSignupTimer",
		raw.Workers.ReconcileHubSignupTimer,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	reconcileHubEmailChangeTimer, err := positiveDuration(
		"workers.reconcileHubEmailChangeTimer",
		raw.Workers.ReconcileHubEmailChangeTimer,
	)
	if err != nil {
		return Config{}, configError(path, err)
	}
	orgWorkers, err := parseOrgWorkers(raw.Workers)
	if err != nil {
		return Config{}, configError(path, err)
	}
	smtp, err := parseSMTP(*raw.SMTP)
	if err != nil {
		return Config{}, configError(path, err)
	}

	return Config{
		SignupRegionsFile: raw.SignupRegionsFile,
		TenantID:          raw.TenantID,
		Env:               environment,
		Database: Database{
			Host:         raw.Database.Host,
			Port:         uint16(raw.Database.Port),
			User:         raw.Database.User,
			Name:         raw.Database.Name,
			PasswordFile: raw.Database.PasswordFile,
			SSLMode:      raw.Database.SSLMode,
		},
		AdminAPIServer: AdminAPIServer{
			SessionTTL: adminSessionTTL,
		},
		MeshAPIServer: MeshAPIServer{
			BaseURL:        meshBaseURL,
			CredentialFile: raw.MeshAPIServer.CredentialFile,
			RequestTimeout: meshTimeout,
			PeerAddress:    raw.MeshAPIServer.PeerAddress,
			PeerTLS: MeshServerTLS{
				CertificateFile: raw.MeshAPIServer.PeerTLS.CertificateFile,
				KeyFile:         raw.MeshAPIServer.PeerTLS.KeyFile,
				ClientCAFile:    raw.MeshAPIServer.PeerTLS.ClientCAFile,
			},
		},
		GlobalCoordinator: GlobalCoordinator{
			BaseURL:        strings.TrimRight(coordinatorURL.String(), "/"),
			RequestTimeout: coordinatorTimeout,
			TLS: MeshClientTLS{
				CertificateFile: raw.GlobalCoordinator.TLS.CertificateFile,
				KeyFile:         raw.GlobalCoordinator.TLS.KeyFile,
				CAFile:          raw.GlobalCoordinator.TLS.CAFile,
				ServerName:      raw.GlobalCoordinator.TLS.ServerName,
			},
		},
		Workers: Workers{
			RetryBackoffLimit:            retryBackoffLimit,
			PruneAdminSessionsTimer:      pruneTimer,
			PruneEphemeralDataTimer:      pruneEphemeralTimer,
			DeliverHubEmailTimer:         deliverHubEmailTimer,
			HubEmailLeaseTTL:             hubEmailLeaseTTL,
			HubEmailMaxAttempts:          raw.Workers.HubEmailMaxAttempts,
			AdvanceHubSubscriptionsTimer: advanceHubSubscriptionsTimer,
			ReconcileHubSignupTimer:      reconcileHubSignupTimer,
			ReconcileHubEmailChangeTimer: reconcileHubEmailChangeTimer,
			DeliverOrgEmailTimer:         orgWorkers.DeliverOrgEmailTimer,
			OrgEmailLeaseTTL:             orgWorkers.OrgEmailLeaseTTL,
			OrgEmailMaxAttempts:          orgWorkers.OrgEmailMaxAttempts,
			ReconcileOrgSignupTimer:      orgWorkers.ReconcileOrgSignupTimer,
			VerifyOrgDomainsTimer:        orgWorkers.VerifyOrgDomainsTimer,
		},
		HubAPIServer: HubAPIServer{
			Signup:               admission,
			SessionTTL:           hubSessionTTL,
			RememberedSessionTTL: rememberedSessionTTL,
			PublicBaseURL:        hubBaseURL,
			OfferedPlans:         offeredPlans,
		},
		ObjectStorage: ObjectStorage{
			PrivateBaseURL: privateObjectURL,
			MediaBaseURL:   mediaURL,
			AccessKeyFile:  raw.ObjectStorage.AccessKeyFile,
			SecretKeyFile:  raw.ObjectStorage.SecretKeyFile,
		},
		SMTP:                  smtp,
		OrgsAPIServer:         orgsAPIServer,
		OrgDomainVerification: orgDomainVerification,
		OrgBilling:            orgBilling,
		MCPServer:             Server{},
	}, nil
}

func (s ObjectStorage) Credentials() (string, string, error) {
	accessKey, err := readTrimmedSecret("object-storage access key", s.AccessKeyFile)
	if err != nil {
		return "", "", err
	}
	secretKey, err := readTrimmedSecret("object-storage secret key", s.SecretKeyFile)
	if err != nil {
		return "", "", err
	}
	if len(accessKey) < 16 || len(secretKey) < 32 {
		return "", "", fmt.Errorf("object-storage credentials are too short")
	}
	return accessKey, secretKey, nil
}

func (m MeshAPIServer) Credential() (string, error) {
	return readCredential("mesh", m.CredentialFile)
}

func readCredential(kind, path string) (string, error) {
	value, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s credential file %q: %w", kind, path, err)
	}
	credential := strings.TrimRight(string(value), "\r\n")
	if len(credential) < 32 {
		return "", fmt.Errorf(
			"%s credential file %q must contain at least 32 bytes", kind, path,
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

func OrgsCredentialSecret() (string, error) {
	path := os.Getenv("ORGS_CREDENTIAL_KEY_FILE")
	if path == "" {
		path = defaultOrgsCredentialKeyPath
	}
	return credentialSecret("orgs", path)
}

// IdentityDigestSecret is, unlike the per-portal credential secrets above,
// identical in every tenant: it derives the shared identitydigest.Key so
// every tenant computes the same digest for the same address. Only hub-api
// and workers read it.
func IdentityDigestSecret() (string, error) {
	path := os.Getenv("IDENTITY_DIGEST_KEY_FILE")
	if path == "" {
		path = defaultIdentityDigestKeyPath
	}
	return credentialSecret("identity digest", path)
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

func parseOrgsAPIServer(raw fileOrgsAPIServer) (OrgsAPIServer, error) {
	admission := regions.Admission{Enabled: true}
	if raw.Signup != nil {
		admission = *raw.Signup
	}
	sessionTTL, err := positiveDuration(
		"orgsAPIServer.sessionTTL", raw.SessionTTL,
	)
	if err != nil {
		return OrgsAPIServer{}, err
	}
	signupTTL, err := positiveDuration(
		"orgsAPIServer.signupTTL", raw.SignupTTL,
	)
	if err != nil {
		return OrgsAPIServer{}, err
	}
	invitationTTL, err := positiveDuration(
		"orgsAPIServer.invitationTTL", raw.InvitationTTL,
	)
	if err != nil {
		return OrgsAPIServer{}, err
	}
	publicBaseURL, err := httpOrigin(
		"orgsAPIServer.publicBaseURL", raw.PublicBaseURL,
	)
	if err != nil {
		return OrgsAPIServer{}, err
	}
	server := OrgsAPIServer{
		Signup:        admission,
		SessionTTL:    sessionTTL,
		SignupTTL:     signupTTL,
		InvitationTTL: invitationTTL,
		PublicBaseURL: publicBaseURL,
	}
	if raw.GoogleSignIn != nil {
		google, err := parseGoogleSignIn(*raw.GoogleSignIn)
		if err != nil {
			return OrgsAPIServer{}, err
		}
		server.GoogleSignIn = &google
	}
	return server, nil
}

func parseGoogleSignIn(raw fileGoogleSignIn) (GoogleSignIn, error) {
	const prefix = "orgsAPIServer.googleSignIn."
	issuer, err := httpOrigin(prefix+"issuer", raw.Issuer)
	if err != nil {
		return GoogleSignIn{}, err
	}
	discoveryURL := ""
	if raw.DiscoveryURL != "" {
		discoveryURL, err = httpOrigin(prefix+"discoveryURL", raw.DiscoveryURL)
		if err != nil {
			return GoogleSignIn{}, err
		}
	}
	if err := required(prefix+"clientID", raw.ClientID); err != nil {
		return GoogleSignIn{}, err
	}
	if err := required(
		prefix+"clientSecretFile", raw.ClientSecretFile,
	); err != nil {
		return GoogleSignIn{}, err
	}
	redirect, err := url.Parse(raw.RedirectURI)
	if err != nil || redirect.Host == "" || redirect.User != nil ||
		(redirect.Scheme != "http" && redirect.Scheme != "https") ||
		redirect.RawQuery != "" || redirect.Fragment != "" ||
		redirect.Path == "" || redirect.Path == "/" {
		return GoogleSignIn{}, fmt.Errorf(
			"%sredirectURI must be an absolute HTTP(S) URL with a path",
			prefix,
		)
	}
	return GoogleSignIn{
		Issuer: issuer, DiscoveryURL: discoveryURL, ClientID: raw.ClientID,
		ClientSecretFile: raw.ClientSecretFile, RedirectURI: raw.RedirectURI,
	}, nil
}

func parseOrgBilling(raw fileOrgBilling) (OrgBilling, error) {
	plans, err := parseOrgOfferedPlans(raw.OfferedPlans)
	return OrgBilling{OfferedPlans: plans}, err
}

func parseOrgDomainVerification(
	raw fileOrgDomainVerification,
) (OrgDomainVerification, error) {
	const prefix = "orgDomainVerification."
	result := OrgDomainVerification{
		ResolverAddress:  raw.ResolverAddress,
		FailureThreshold: raw.FailureThreshold,
	}
	if err := validateResolverAddress(
		prefix+"resolverAddress", raw.ResolverAddress,
	); err != nil {
		return OrgDomainVerification{}, err
	}
	for _, field := range []struct {
		name   string
		value  string
		target *time.Duration
	}{
		{"lookupTimeout", raw.LookupTimeout, &result.LookupTimeout},
		{"checkInterval", raw.CheckInterval, &result.CheckInterval},
		{"failingGracePeriod", raw.FailingGracePeriod, &result.FailingGracePeriod},
		{"inconclusiveRetry", raw.InconclusiveRetry, &result.InconclusiveRetry},
		{"inconclusiveLimit", raw.InconclusiveLimit, &result.InconclusiveLimit},
	} {
		duration, err := positiveDuration(prefix+field.name, field.value)
		if err != nil {
			return OrgDomainVerification{}, err
		}
		*field.target = duration
	}
	if raw.FailureThreshold < 1 || raw.FailureThreshold > 10 {
		return OrgDomainVerification{}, fmt.Errorf(
			"%sfailureThreshold must be between 1 and 10", prefix,
		)
	}
	// Retries of an inconclusive lookup happen within one check cycle, so a
	// retry delay as long as the cycle would never run before the next
	// scheduled check.
	if result.InconclusiveRetry >= result.CheckInterval {
		return OrgDomainVerification{}, fmt.Errorf(
			"%sinconclusiveRetry must be shorter than checkInterval", prefix,
		)
	}
	return result, nil
}

// validateResolverAddress does not resolve the host: a Compose service name
// such as dns-dev resolves only inside the container network.
func validateResolverAddress(name, value string) error {
	host, port, err := net.SplitHostPort(value)
	if err != nil || host == "" {
		return fmt.Errorf("%s must be a host:port address", name)
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return fmt.Errorf("%s must have a port between 1 and 65535", name)
	}
	return nil
}

type orgWorkers struct {
	DeliverOrgEmailTimer    time.Duration
	OrgEmailLeaseTTL        time.Duration
	OrgEmailMaxAttempts     int
	ReconcileOrgSignupTimer time.Duration
	VerifyOrgDomainsTimer   time.Duration
}

func parseOrgWorkers(raw fileWorkers) (orgWorkers, error) {
	result := orgWorkers{OrgEmailMaxAttempts: raw.OrgEmailMaxAttempts}
	for _, field := range []struct {
		name   string
		value  string
		target *time.Duration
	}{
		{"deliverOrgEmailTimer", raw.DeliverOrgEmailTimer, &result.DeliverOrgEmailTimer},
		{"orgEmailLeaseTTL", raw.OrgEmailLeaseTTL, &result.OrgEmailLeaseTTL},
		{"reconcileOrgSignupTimer", raw.ReconcileOrgSignupTimer, &result.ReconcileOrgSignupTimer},
		{"verifyOrgDomainsTimer", raw.VerifyOrgDomainsTimer, &result.VerifyOrgDomainsTimer},
	} {
		duration, err := positiveDuration("workers."+field.name, field.value)
		if err != nil {
			return orgWorkers{}, err
		}
		*field.target = duration
	}
	if raw.OrgEmailMaxAttempts < 1 || raw.OrgEmailMaxAttempts > 20 {
		return orgWorkers{}, fmt.Errorf(
			"workers.orgEmailMaxAttempts must be between 1 and 20",
		)
	}
	return result, nil
}

// parseOfferedPlans has no silent default: that would let the backend and
// hub-ui portal disagree on offered plans without anyone editing either file.
func parseOfferedPlans(values []string) ([]subscriptionspec.Plan, error) {
	if len(values) == 0 {
		return nil, fmt.Errorf("hubAPIServer.offeredPlans must not be empty")
	}
	plans := make([]subscriptionspec.Plan, 0, len(values))
	seen := make(map[subscriptionspec.Plan]bool, len(values))
	for _, value := range values {
		plan := subscriptionspec.Plan(value)
		if !subscriptionspec.IsPlan(subscriptionspec.PlanOID(plan)) {
			return nil, fmt.Errorf(
				"hubAPIServer.offeredPlans: unknown plan %q", value,
			)
		}
		if seen[plan] {
			return nil, fmt.Errorf(
				"hubAPIServer.offeredPlans: duplicate plan %q", value,
			)
		}
		seen[plan] = true
		plans = append(plans, plan)
	}
	if !slices.Contains(plans, subscriptionspec.DefaultPlan) {
		return nil, fmt.Errorf(
			"hubAPIServer.offeredPlans must include %q",
			subscriptionspec.DefaultPlan,
		)
	}
	return plans, nil
}

// parseOrgOfferedPlans has no silent default, for the same reason as
// parseOfferedPlans.
func parseOrgOfferedPlans(
	values []string,
) ([]orgsubscriptionspec.Plan, error) {
	if len(values) == 0 {
		return nil, fmt.Errorf("orgBilling.offeredPlans must not be empty")
	}
	plans := make([]orgsubscriptionspec.Plan, 0, len(values))
	seen := make(map[orgsubscriptionspec.Plan]bool, len(values))
	for _, value := range values {
		plan := orgsubscriptionspec.Plan(value)
		if !orgsubscriptionspec.IsPlan(orgsubscriptionspec.PlanOID(plan)) {
			return nil, fmt.Errorf(
				"orgBilling.offeredPlans: unknown plan %q", value,
			)
		}
		if seen[plan] {
			return nil, fmt.Errorf(
				"orgBilling.offeredPlans: duplicate plan %q", value,
			)
		}
		seen[plan] = true
		plans = append(plans, plan)
	}
	if !slices.Contains(plans, orgsubscriptionspec.DefaultPlan) {
		return nil, fmt.Errorf(
			"orgBilling.offeredPlans must include %q",
			orgsubscriptionspec.DefaultPlan,
		)
	}
	return plans, nil
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
