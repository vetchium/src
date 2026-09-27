package appconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

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
		cfg.HubAPIServer.PublicBaseURL != "http://hub-ui.sgp.localhost" {
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
    "publicBaseURL": "http://hub-ui.sgp.localhost",
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
    "publicBaseURL": "http://orgs-ui.sgp.localhost/"
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

// TestCheckedInHubPlansMatchPortalConfiguration compares each tenant's
// backend offeredPlans and tenantId with the literal hub-ui portal
// environment values in the matching compose or stack file, and compares
// VETCHIUM_MEDIA_ORIGINS against every tenant's objectStorage.mediaBaseURL
// for that environment: a federated profile read renders the picture
// owner's home tenant's signed media URL directly in the browser, so every
// tenant's hub-ui must allow every tenant's media origin, not only its own.
// Nothing can compare them at process startup because hub-ui is a static
// nginx container, so this repository test is what catches drift before
// deployment.
func TestCheckedInHubPlansMatchPortalConfiguration(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	regions := []string{"deu", "ind1", "sgp", "usa1"}
	for _, env := range []struct {
		name        string
		configPath  func(region string) string
		composePath func(region string) string
		serviceName func(region string) string
	}{
		{
			"dev",
			func(region string) string {
				return filepath.Join(root, "config", region+".json")
			},
			func(string) string { return filepath.Join(root, "docker-compose.json") },
			func(region string) string { return "hub-ui-" + region },
		},
		{
			"ci",
			func(region string) string {
				return filepath.Join(root, "config", "ci", region+".json")
			},
			func(string) string { return filepath.Join(root, "docker-compose-ci.json") },
			func(region string) string { return "hub-ui-" + region },
		},
		{
			"production",
			func(region string) string {
				return filepath.Join(root, "deploy", region, "config.json")
			},
			func(region string) string {
				return filepath.Join(root, "deploy", region, "stack.json")
			},
			func(string) string { return "hub-ui" },
		},
	} {
		t.Run(env.name, func(t *testing.T) {
			cfgs := make(map[string]Config, len(regions))
			wantMediaOrigins := make([]string, 0, len(regions))
			for _, region := range regions {
				cfg, err := LoadFile(env.configPath(region))
				if err != nil {
					t.Fatal(err)
				}
				cfgs[region] = cfg
				wantMediaOrigins = append(wantMediaOrigins, cfg.ObjectStorage.MediaBaseURL)
			}
			slices.Sort(wantMediaOrigins)

			for _, region := range regions {
				t.Run(region, func(t *testing.T) {
					cfg := cfgs[region]
					composePath := env.composePath(region)
					tenantID, plans, mediaOrigins := hubUIPortalEnvironment(
						t, composePath, env.serviceName(region),
					)
					if tenantID != cfg.TenantID {
						t.Fatalf(
							"%s VETCHIUM_TENANT_ID = %q, want %q (tenantId)",
							composePath, tenantID, cfg.TenantID,
						)
					}
					wantPlans := make([]string, len(cfg.HubAPIServer.OfferedPlans))
					for i, plan := range cfg.HubAPIServer.OfferedPlans {
						wantPlans[i] = string(plan)
					}
					slices.Sort(wantPlans)
					slices.Sort(plans)
					if !slices.Equal(plans, wantPlans) {
						t.Fatalf(
							"%s VETCHIUM_HUB_PLANS = %v, want %v (offeredPlans)",
							composePath, plans, wantPlans,
						)
					}
					slices.Sort(mediaOrigins)
					if !slices.Equal(mediaOrigins, wantMediaOrigins) {
						t.Fatalf(
							"%s VETCHIUM_MEDIA_ORIGINS = %v, want %v (every region's objectStorage.mediaBaseURL)",
							composePath, mediaOrigins, wantMediaOrigins,
						)
					}
				})
			}
		})
	}
}

func hubUIPortalEnvironment(
	t *testing.T, composePath, serviceName string,
) (string, []string, []string) {
	t.Helper()
	contents, err := os.ReadFile(composePath)
	if err != nil {
		t.Fatal(err)
	}
	var compose struct {
		Services map[string]struct {
			Environment map[string]string `json:"environment"`
		} `json:"services"`
	}
	if err := json.Unmarshal(contents, &compose); err != nil {
		t.Fatal(err)
	}
	service, ok := compose.Services[serviceName]
	if !ok {
		t.Fatalf("%s: service %q not found", composePath, serviceName)
	}
	tenantID := service.Environment["VETCHIUM_TENANT_ID"]
	hubPlans := service.Environment["VETCHIUM_HUB_PLANS"]
	mediaOrigins := service.Environment["VETCHIUM_MEDIA_ORIGINS"]
	if tenantID == "" || hubPlans == "" || mediaOrigins == "" {
		t.Fatalf(
			"%s: service %q is missing VETCHIUM_TENANT_ID, VETCHIUM_HUB_PLANS, or VETCHIUM_MEDIA_ORIGINS",
			composePath, serviceName,
		)
	}
	return tenantID, strings.Split(hubPlans, ","), strings.Split(mediaOrigins, ",")
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
    "publicBaseURL": "http://hub-ui.sgp.localhost",
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
    "publicBaseURL": "http://orgs-ui.sgp.localhost/"
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
  "mcpServer": {}
}`, passwordFile, extraWorkerField)
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
