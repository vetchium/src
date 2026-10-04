package appconfig

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"backend/internal/regions"
	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func TestLoadFile(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(
		passwordFile, []byte("p@ss/word\n"), 0o600,
	); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadFile(writeConfig(t, passwordFile, ""))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TenantID != "sgp" || cfg.Env != EnvironmentDev ||
		cfg.AdminAPIServer.SessionTTL != 24*time.Hour {
		t.Fatalf("config = %+v, want tenant sgp and admin-session TTL 24h", cfg)
	}
	if cfg.Workers.RetryBackoffLimit != 5*time.Minute ||
		cfg.Workers.PruneAdminSessionsTimer != time.Hour ||
		cfg.Workers.PruneEphemeralDataTimer != time.Hour {
		t.Fatalf(
			"workers config = %+v, want retry limit 5m and prune interval 1h",
			cfg.Workers,
		)
	}
	if cfg.GlobalCoordinator.BaseURL != "https://global-coordinator:8080" ||
		cfg.GlobalCoordinator.RequestTimeout != 5*time.Second ||
		cfg.GlobalCoordinator.TLS.CertificateFile == "" ||
		cfg.GlobalCoordinator.TLS.KeyFile == "" ||
		cfg.GlobalCoordinator.TLS.CAFile == "" ||
		cfg.GlobalCoordinator.TLS.ServerName !=
			"global-coordinator.mesh.vetchium.com" {
		t.Fatalf("global coordinator config = %+v", cfg.GlobalCoordinator)
	}
	if cfg.MeshAPIServer.PeerAddress != ":8443" ||
		cfg.MeshAPIServer.PeerTLS.CertificateFile == "" ||
		cfg.MeshAPIServer.PeerTLS.KeyFile == "" ||
		cfg.MeshAPIServer.PeerTLS.ClientCAFile == "" {
		t.Fatalf("mesh API config = %+v", cfg.MeshAPIServer)
	}
	if cfg.HubAPIServer.SessionTTL != 24*time.Hour ||
		cfg.HubAPIServer.RememberedSessionTTL != 6360*time.Hour ||
		cfg.HubAPIServer.PublicBaseURL != "http://vetchium.localhost" {
		t.Fatalf("hub API config = %+v", cfg.HubAPIServer)
	}
	if !slices.Equal(cfg.HubAPIServer.OfferedPlans, []subscriptionspec.Plan{
		subscriptionspec.FreeTier, subscriptionspec.SilverTier,
	}) {
		t.Fatalf("offered plans = %v", cfg.HubAPIServer.OfferedPlans)
	}
	if cfg.ObjectStorage.PrivateBaseURL != "http://seaweed-s3-sgp:8333" ||
		cfg.ObjectStorage.MediaBaseURL != "http://media.sgp.localhost" {
		t.Fatalf("object storage config = %+v", cfg.ObjectStorage)
	}
	if cfg.Workers.AdvanceHubSubscriptionsTimer != time.Minute {
		t.Fatalf(
			"advance hub subscriptions timer = %s, want 1m",
			cfg.Workers.AdvanceHubSubscriptionsTimer,
		)
	}
	if cfg.Workers.ReconcileHubSignupTimer != time.Minute {
		t.Fatalf(
			"reconcile Hub signup timer = %s, want 1m",
			cfg.Workers.ReconcileHubSignupTimer,
		)
	}
	if cfg.Workers.ReconcileHubEmailChangeTimer != time.Minute {
		t.Fatalf(
			"reconcile Hub email change timer = %s, want 1m",
			cfg.Workers.ReconcileHubEmailChangeTimer,
		)
	}
	if cfg.SMTP.Host != "mailpit" || cfg.SMTP.Port != 1025 ||
		cfg.SMTP.StartTLS != StartTLSDisabled {
		t.Fatalf("SMTP config = %+v", cfg.SMTP)
	}

	databaseURL, err := cfg.Database.URL()
	if err != nil {
		t.Fatal(err)
	}
	wantedURLParts := []string{
		"pguser:p%40ss%2Fword", "db:5433",
		"/tenant_db", "sslmode=verify-full",
	}
	for _, want := range wantedURLParts {
		if !strings.Contains(databaseURL, want) {
			t.Errorf("database URL = %q, missing %q", databaseURL, want)
		}
	}
	if strings.Contains(databaseURL, "%0A") {
		t.Fatalf("database URL contains password-file newline: %q", databaseURL)
	}
}

func TestLoadUsesConfiguredPathAndDatabaseOverrides(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(passwordFile, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APP_CONFIG_FILE", writeConfig(t, passwordFile, ""))
	t.Setenv("PGDATABASE", "overridden_db")
	t.Setenv("PGSSLMODE", "require")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Database.Name != "overridden_db" || cfg.Database.SSLMode != "require" {
		t.Fatalf("database config = %+v, want deployment overrides", cfg.Database)
	}
}

func TestAdminCredentialSecretUsesConfiguredFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "admin-credential-key")
	if err := os.WriteFile(path, []byte("separate-secret\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ADMIN_CREDENTIAL_KEY_FILE", path)

	secret, err := AdminCredentialSecret()
	if err != nil {
		t.Fatal(err)
	}
	if secret != "separate-secret" {
		t.Fatalf("AdminCredentialSecret() = %q, want trimmed secret", secret)
	}
}

func TestAdminCredentialSecretRejectsEmptyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "admin-credential-key")
	if err := os.WriteFile(path, []byte("\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ADMIN_CREDENTIAL_KEY_FILE", path)

	_, err := AdminCredentialSecret()
	if err == nil || !strings.Contains(err.Error(), "is empty") {
		t.Fatalf("AdminCredentialSecret() error = %v, want empty-file error", err)
	}
}

func TestHubCredentialSecretUsesConfiguredFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hub-credential-key")
	if err := os.WriteFile(path, []byte("hub-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HUB_CREDENTIAL_KEY_FILE", path)

	secret, err := HubCredentialSecret()
	if err != nil {
		t.Fatal(err)
	}
	if secret != "hub-secret" {
		t.Fatalf("HubCredentialSecret() = %q, want trimmed secret", secret)
	}
}

func TestIdentityDigestSecretUsesConfiguredFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity-digest-key")
	if err := os.WriteFile(path, []byte("identity-secret\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("IDENTITY_DIGEST_KEY_FILE", path)

	secret, err := IdentityDigestSecret()
	if err != nil {
		t.Fatal(err)
	}
	if secret != "identity-secret" {
		t.Fatalf("IdentityDigestSecret() = %q, want trimmed secret", secret)
	}
}

func TestIdentityDigestSecretRejectsEmptyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity-digest-key")
	if err := os.WriteFile(path, []byte("\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("IDENTITY_DIGEST_KEY_FILE", path)

	_, err := IdentityDigestSecret()
	if err == nil || !strings.Contains(err.Error(), "is empty") {
		t.Fatalf("IdentityDigestSecret() error = %v, want empty-file error", err)
	}
}

func TestParseSMTPRequiresTLSForCredentials(t *testing.T) {
	for _, mode := range []StartTLSMode{
		StartTLSDisabled,
		StartTLSOpportunistic,
	} {
		t.Run(string(mode), func(t *testing.T) {
			_, err := parseSMTP(fileSMTP{
				Host: "smtp.example.com", Port: 587,
				FromAddress: "noreply@example.com", FromName: "Vetchium",
				UsernameFile:      "/run/secrets/smtp_username",
				PasswordFile:      "/run/secrets/smtp_password",
				StartTLS:          string(mode),
				ConnectionTimeout: "10s",
			})
			if err == nil || !strings.Contains(err.Error(), "must be required") {
				t.Fatalf(
					"parseSMTP() error = %v, want TLS-required error", err,
				)
			}
		})
	}
}

func TestLoadFileRejectsUnknownFields(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := writeConfig(t, passwordFile, `,"pruneInterval":"1h"`)

	_, err := LoadFile(path)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("LoadFile() error = %v, want unknown field error", err)
	}
}

func TestLoadFileRejectsLegacySectionNames(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := writeConfig(t, passwordFile, "")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	contents = []byte(strings.Replace(
		string(contents), `"adminAPIServer"`, `"admin-api-server"`, 1,
	))
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = LoadFile(path)
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("LoadFile() error = %v, want legacy-key rejection", err)
	}
}

func TestLoadFileRejectsUnknownEnvironment(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := writeConfig(t, passwordFile, "")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	contents = []byte(strings.Replace(
		string(contents), `"env": "dev"`, `"env": "preview"`, 1,
	))
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = LoadFile(path)
	if err == nil || !strings.Contains(err.Error(), "env must be one of") {
		t.Fatalf("LoadFile() error = %v, want environment error", err)
	}
}

func TestLoadFileRejectsCoordinatorURLCredentials(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := writeConfig(t, passwordFile, "")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	contents = []byte(strings.Replace(
		string(contents),
		"https://global-coordinator:8080",
		"https://credential@global-coordinator:8080",
		1,
	))
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = LoadFile(path)
	if err == nil || !strings.Contains(err.Error(), "must be an HTTPS origin") {
		t.Fatalf("LoadFile() error = %v, want coordinator origin error", err)
	}
}

func TestLoadFileRejectsInsecureCoordinatorURL(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := writeConfig(t, passwordFile, "")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	contents = []byte(strings.Replace(
		string(contents),
		"https://global-coordinator:8080",
		"http://global-coordinator:8080",
		1,
	))
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = LoadFile(path)
	if err == nil || !strings.Contains(err.Error(), "must be an HTTPS origin") {
		t.Fatalf("LoadFile() error = %v, want HTTPS-only error", err)
	}
}

func TestLoadFileAcceptsCIEnvironment(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := writeConfig(t, passwordFile, "")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	contents = []byte(strings.Replace(
		string(contents), "\"env\": \"dev\"", "\"env\": \"ci\"", 1,
	))
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Env != EnvironmentCI {
		t.Fatalf("environment = %q, want %q", cfg.Env, EnvironmentCI)
	}
}

func TestProductionMediaOriginMustUseHTTPS(t *testing.T) {
	path := writeConfig(t, "password-not-read", "")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	contents = []byte(strings.Replace(string(contents),
		`"env": "dev"`, `"env": "production"`, 1))
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadFile(path); err == nil ||
		!strings.Contains(err.Error(), "mediaBaseURL must use HTTPS") {
		t.Fatalf("insecure production media origin error = %v", err)
	}
}

func TestLoadFileRequiresPositiveDurations(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := filepath.Join(t.TempDir(), "config.json")
	contents := fmt.Sprintf(`{
  "signupRegionsFile": "/etc/vetchium/signup-regions.json",
  "tenantId": "sgp",
  "env": "dev",
  "database": {
    "host": "db",
    "port": 5432,
    "user": "pguser",
    "name": "tenant_db",
    "passwordFile": %q,
    "sslMode": "disable"
  },
  "workers": {
    "retryBackoffLimit": "0s",
    "pruneAdminSessionsTimer": "1h",
    "pruneEphemeralDataTimer": "1h",
    "deliverHubEmailTimer": "1s",
    "hubEmailLeaseTTL": "1m",
    "hubEmailMaxAttempts": 5,
    "advanceHubSubscriptionsTimer": "1m",
    "reconcileHubSignupTimer": "1m",
    "reconcileHubEmailChangeTimer": "1m",
    "deliverOrgEmailTimer": "1s",
    "orgEmailLeaseTTL": "1m",
    "orgEmailMaxAttempts": 5,
    "reconcileOrgSignupTimer": "1m",
    "verifyOrgDomainsTimer": "1m"
  },
  "adminAPIServer": {
    "sessionTTL": "24h"
  },
  "globalCoordinator": {
    "baseURL": "https://global-coordinator:8080",
    "requestTimeout": "5s",
    "tls": {
      "certificateFile": "/run/secrets/mesh_client_certificate",
      "keyFile": "/run/secrets/mesh_client_key",
      "caFile": "/run/secrets/mesh_ca_certificate",
      "serverName": "global-coordinator.mesh.vetchium.com"
    }
  },
  "meshAPIServer": {
    "baseURL": "http://mesh-api-sgp:8080",
    "credentialFile": "/run/secrets/mesh_credential",
    "requestTimeout": "5s",
    "peerAddress": ":8443",
    "peerTLS": {
      "certificateFile": "/run/secrets/mesh_server_certificate",
      "keyFile": "/run/secrets/mesh_server_key",
      "clientCAFile": "/run/secrets/mesh_ca_certificate"
    }
  },
  "hubAPIServer": {
    "sessionTTL": "24h",
    "rememberedSessionTTL": "6360h",
    "publicBaseURL": "http://vetchium.localhost",
    "offeredPlans": ["hub-free-tier", "hub-silver-tier"]
  },
  "objectStorage": {
    "privateBaseURL": "http://seaweed-s3-sgp:8333",
    "mediaBaseURL": "http://media.sgp.localhost",
    "accessKeyFile": "/run/secrets/seaweed_s3_access_key",
    "secretKeyFile": "/run/secrets/seaweed_s3_secret_key"
  },
  "smtp": {
    "host": "mailpit",
    "port": 1025,
    "fromAddress": "no-reply@vetchium.local",
    "fromName": "Vetchium",
    "usernameFile": "",
    "passwordFile": "",
    "startTLS": "disabled",
    "connectionTimeout": "5s"
  },
  "orgsAPIServer": {
    "sessionTTL": "12h",
    "signupTTL": "168h",
    "invitationTTL": "168h",
    "publicBaseURL": "http://orgs.vetchium.localhost/"
  },
  "orgDomainVerification": {
    "resolverAddress": "dns-dev:53",
    "lookupTimeout": "5s",
    "checkInterval": "168h",
    "failureThreshold": 2,
    "failingGracePeriod": "720h",
    "inconclusiveRetry": "1h",
    "inconclusiveLimit": "168h"
  },
  "orgBilling": {
    "offeredPlans": ["org-free-tier", "org-silver-tier", "org-gold-tier"]
  },
  "mcpServer": {}
}`, passwordFile)
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := LoadFile(path)
	if err == nil || !strings.Contains(
		err.Error(), "workers.retryBackoffLimit must be positive",
	) {
		t.Fatalf("LoadFile() error = %v, want positive retry backoff error", err)
	}
}

func TestLoadFileRequiresPositiveAdvanceHubSubscriptionsTimer(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := writeConfig(t, passwordFile, "")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	contents = []byte(strings.Replace(
		string(contents),
		`"advanceHubSubscriptionsTimer": "1m"`,
		`"advanceHubSubscriptionsTimer": "0s"`,
		1,
	))
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = LoadFile(path)
	if err == nil || !strings.Contains(
		err.Error(), "workers.advanceHubSubscriptionsTimer must be positive",
	) {
		t.Fatalf("LoadFile() error = %v, want positive timer error", err)
	}
}

func TestLoadFileRejectsOfferedPlansRules(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	for _, test := range []struct {
		name        string
		replacement string
		wantError   string
	}{
		{
			"empty", `"offeredPlans": []`,
			"hubAPIServer.offeredPlans must not be empty",
		},
		{
			"unknown plan", `"offeredPlans": ["hub-free-tier", "hub-gold-tier"]`,
			"unknown plan",
		},
		{
			"duplicate",
			`"offeredPlans": ["hub-free-tier", "hub-free-tier"]`,
			"duplicate plan",
		},
		{
			"missing free tier", `"offeredPlans": ["hub-silver-tier"]`,
			"must include",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := writeConfig(t, passwordFile, "")
			contents, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			contents = []byte(strings.Replace(
				string(contents),
				`"offeredPlans": ["hub-free-tier", "hub-silver-tier"]`,
				test.replacement, 1,
			))
			if err := os.WriteFile(path, contents, 0o600); err != nil {
				t.Fatal(err)
			}
			_, err = LoadFile(path)
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf(
					"LoadFile() error = %v, want error containing %q",
					err, test.wantError,
				)
			}
		})
	}
}

func TestLoadFileRejectsMissingOfferedPlans(t *testing.T) {
	passwordFile := filepath.Join(t.TempDir(), "password")
	path := writeConfig(t, passwordFile, "")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	contents = []byte(strings.Replace(
		string(contents),
		`,
    "offeredPlans": ["hub-free-tier", "hub-silver-tier"]`,
		"", 1,
	))
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = LoadFile(path)
	if err == nil || !strings.Contains(
		err.Error(), "hubAPIServer.offeredPlans must not be empty",
	) {
		t.Fatalf("LoadFile() error = %v, want empty offeredPlans error", err)
	}
}

func TestCheckedInConfigs(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	for _, region := range []string{"deu", "ind1", "sgp", "usa1"} {
		for _, test := range []struct {
			path string
			env  Environment
		}{
			{
				filepath.Join(root, "config", "ci", region+".json"),
				EnvironmentCI,
			},
			{
				filepath.Join(root, "config", region+".json"),
				EnvironmentDev,
			},
			{
				filepath.Join(root, "deploy", region, "config.json"),
				EnvironmentProduction,
			},
		} {
			t.Run(test.path, func(t *testing.T) {
				cfg, err := LoadFile(test.path)
				if err != nil {
					t.Fatal(err)
				}
				if cfg.TenantID != region || cfg.Env != test.env {
					t.Fatalf(
						"config identifies tenant %q in %q, want tenant %q in %q",
						cfg.TenantID, cfg.Env, region, test.env,
					)
				}
			})
		}
	}
}

func writeConfig(t *testing.T, passwordFile, extraWorkerField string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	contents := fmt.Sprintf(`{
  "signupRegionsFile": "/etc/vetchium/signup-regions.json",
  "tenantId": "sgp",
  "env": "dev",
  "database": {
    "host": "db",
    "port": 5433,
    "user": "pguser",
    "name": "tenant_db",
    "passwordFile": %q,
    "sslMode": "verify-full"
  },
  "workers": {
    "retryBackoffLimit": "5m",
    "pruneAdminSessionsTimer": "1h",
    "pruneEphemeralDataTimer": "1h",
    "deliverHubEmailTimer": "1s",
    "hubEmailLeaseTTL": "1m",
    "hubEmailMaxAttempts": 5,
    "advanceHubSubscriptionsTimer": "1m",
    "reconcileHubSignupTimer": "1m",
    "reconcileHubEmailChangeTimer": "1m",
    "deliverOrgEmailTimer": "1s",
    "orgEmailLeaseTTL": "1m",
    "orgEmailMaxAttempts": 5,
    "reconcileOrgSignupTimer": "1m",
    "verifyOrgDomainsTimer": "1m"%s
  },
  "adminAPIServer": {
    "sessionTTL": "24h"
  },
  "globalCoordinator": {
    "baseURL": "https://global-coordinator:8080",
    "requestTimeout": "5s",
    "tls": {
      "certificateFile": "/run/secrets/mesh_client_certificate",
      "keyFile": "/run/secrets/mesh_client_key",
      "caFile": "/run/secrets/mesh_ca_certificate",
      "serverName": "global-coordinator.mesh.vetchium.com"
    }
  },
  "meshAPIServer": {
    "baseURL": "http://mesh-api-sgp:8080",
    "credentialFile": "/run/secrets/mesh_credential",
    "requestTimeout": "5s",
    "peerAddress": ":8443",
    "peerTLS": {
      "certificateFile": "/run/secrets/mesh_server_certificate",
      "keyFile": "/run/secrets/mesh_server_key",
      "clientCAFile": "/run/secrets/mesh_ca_certificate"
    }
  },
  "hubAPIServer": {
    "sessionTTL": "24h",
    "rememberedSessionTTL": "6360h",
    "publicBaseURL": "http://vetchium.localhost",
    "offeredPlans": ["hub-free-tier", "hub-silver-tier"]
  },
  "objectStorage": {
    "privateBaseURL": "http://seaweed-s3-sgp:8333",
    "mediaBaseURL": "http://media.sgp.localhost",
    "accessKeyFile": "/run/secrets/seaweed_s3_access_key",
    "secretKeyFile": "/run/secrets/seaweed_s3_secret_key"
  },
  "smtp": {
    "host": "mailpit",
    "port": 1025,
    "fromAddress": "no-reply@vetchium.local",
    "fromName": "Vetchium",
    "usernameFile": "",
    "passwordFile": "",
    "startTLS": "disabled",
    "connectionTimeout": "5s"
  },
  "orgsAPIServer": {
    "sessionTTL": "12h",
    "signupTTL": "168h",
    "invitationTTL": "168h",
    "publicBaseURL": "http://orgs.vetchium.localhost/"
  },
  "orgDomainVerification": {
    "resolverAddress": "dns-dev:53",
    "lookupTimeout": "5s",
    "checkInterval": "168h",
    "failureThreshold": 2,
    "failingGracePeriod": "720h",
    "inconclusiveRetry": "1h",
    "inconclusiveLimit": "168h"
  },
  "orgBilling": {
    "offeredPlans": ["org-free-tier", "org-silver-tier", "org-gold-tier"]
  },
  "mcpServer": {}
}`, passwordFile, extraWorkerField)
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestOrgUnavailableFixtureConfiguration(t *testing.T) {
	t.Parallel()
	cfg, err := LoadFile(filepath.Join("..", "..", "..", "config", "ci", "fixtures", "orgs-unavailable.json"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Env != EnvironmentCI || cfg.TenantID != "sgp" || cfg.OrgsAPIServer.Signup.Enabled || cfg.OrgsAPIServer.GoogleSignIn != nil {
		t.Fatal("Org unavailable fixture must be a CI sgp instance with signup and Google sign-in unavailable")
	}
	catalog, err := regions.Load(filepath.Join("..", "..", "..", "config", "ci", "fixtures", "orgs-unavailable-regions.json"))
	if err != nil {
		t.Fatal(err)
	}
	if catalog.OrgSignupEnabled(cfg.TenantID) != cfg.OrgsAPIServer.Signup.Enabled {
		t.Fatal("fixture signup catalog and API must agree")
	}
}
