package appconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"backend/internal/regions"
)

func TestLoadFileParsesOrgSettings(t *testing.T) {
	t.Parallel()
	cfg, err := LoadFile(writeConfig(t, "password-not-read", ""))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.OrgsAPIServer != (OrgsAPIServer{
		Signup:        regions.Admission{Enabled: true},
		SessionTTL:    12 * time.Hour,
		PublicBaseURL: "http://orgs-ui.sgp.localhost",
	}) {
		t.Fatalf("orgs API config = %+v", cfg.OrgsAPIServer)
	}
	if cfg.OrgDomainVerification != (OrgDomainVerification{
		ResolverAddress:    "dns-dev:53",
		LookupTimeout:      5 * time.Second,
		CheckInterval:      168 * time.Hour,
		FailureThreshold:   2,
		FailingGracePeriod: 720 * time.Hour,
		InconclusiveRetry:  time.Hour,
		InconclusiveLimit:  168 * time.Hour,
	}) {
		t.Fatalf("org domain verification = %+v", cfg.OrgDomainVerification)
	}
	if cfg.Workers.DeliverOrgEmailTimer != time.Second ||
		cfg.Workers.OrgEmailLeaseTTL != time.Minute ||
		cfg.Workers.OrgEmailMaxAttempts != 5 ||
		cfg.Workers.ReconcileOrgSignupTimer != time.Minute ||
		cfg.Workers.VerifyOrgDomainsTimer != time.Minute {
		t.Fatalf("org worker config = %+v", cfg.Workers)
	}
}

func TestLoadFileReadsOrgSignupSwitch(t *testing.T) {
	t.Parallel()
	path := editConfig(t,
		`"publicBaseURL": "http://orgs-ui.sgp.localhost/"`,
		`"publicBaseURL": "http://orgs-ui.sgp.localhost/",
    "signup": {"enabled": false}`,
	)
	cfg, err := LoadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.OrgsAPIServer.Signup.Enabled {
		t.Fatal("orgsAPIServer.signup.enabled = true, want false")
	}
}

func TestLoadFileRejectsInvalidOrgSettings(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, old, replacement, wantError string
	}{
		{
			"missing orgs session TTL", `"sessionTTL": "12h",`, ``,
			"missing orgsAPIServer.sessionTTL",
		},
		{
			"non-positive orgs session TTL", `"sessionTTL": "12h"`,
			`"sessionTTL": "0s"`, "orgsAPIServer.sessionTTL must be positive",
		},
		{
			"missing orgs public URL",
			`,
    "publicBaseURL": "http://orgs-ui.sgp.localhost/"`, ``,
			"orgsAPIServer.publicBaseURL must be an HTTP(S) origin",
		},
		{
			"orgs public URL with path",
			`"http://orgs-ui.sgp.localhost/"`,
			`"http://orgs-ui.sgp.localhost/app"`,
			"orgsAPIServer.publicBaseURL must be an HTTP(S) origin",
		},
		{
			"orgs public URL with credentials",
			`"http://orgs-ui.sgp.localhost/"`,
			`"http://user@orgs-ui.sgp.localhost"`,
			"orgsAPIServer.publicBaseURL must be an HTTP(S) origin",
		},
		{
			"orgs public URL with another scheme",
			`"http://orgs-ui.sgp.localhost/"`,
			`"ftp://orgs-ui.sgp.localhost"`,
			"orgsAPIServer.publicBaseURL must be an HTTP(S) origin",
		},
		{
			"unknown orgs field", `"sessionTTL": "12h",`,
			`"sessionTTL": "12h", "rememberedSessionTTL": "24h",`,
			"unknown field",
		},
		{
			"missing orgs section",
			`"orgsAPIServer": {
    "sessionTTL": "12h",
    "publicBaseURL": "http://orgs-ui.sgp.localhost/"
  },`, ``,
			"missing orgsAPIServer",
		},
		{
			"missing orgDomainVerification",
			`"orgDomainVerification": {
    "resolverAddress": "dns-dev:53",
    "lookupTimeout": "5s",
    "checkInterval": "168h",
    "failureThreshold": 2,
    "failingGracePeriod": "720h",
    "inconclusiveRetry": "1h",
    "inconclusiveLimit": "168h"
  },`, ``,
			"missing orgDomainVerification",
		},
		{
			"missing resolver", `"resolverAddress": "dns-dev:53"`,
			`"resolverAddress": ""`,
			"orgDomainVerification.resolverAddress must be a host:port address",
		},
		{
			"resolver without port", `"resolverAddress": "dns-dev:53"`,
			`"resolverAddress": "dns-dev"`,
			"orgDomainVerification.resolverAddress must be a host:port address",
		},
		{
			"resolver without host", `"resolverAddress": "dns-dev:53"`,
			`"resolverAddress": ":53"`,
			"orgDomainVerification.resolverAddress must be a host:port address",
		},
		{
			"resolver port zero", `"resolverAddress": "dns-dev:53"`,
			`"resolverAddress": "dns-dev:0"`,
			"orgDomainVerification.resolverAddress must have a port",
		},
		{
			"resolver named port", `"resolverAddress": "dns-dev:53"`,
			`"resolverAddress": "dns-dev:domain"`,
			"orgDomainVerification.resolverAddress must have a port",
		},
		{
			"missing lookup timeout", `"lookupTimeout": "5s",`, ``,
			"missing orgDomainVerification.lookupTimeout",
		},
		{
			"non-positive lookup timeout", `"lookupTimeout": "5s"`,
			`"lookupTimeout": "0s"`,
			"orgDomainVerification.lookupTimeout must be positive",
		},
		{
			"non-positive check interval", `"checkInterval": "168h"`,
			`"checkInterval": "-1h"`,
			"orgDomainVerification.checkInterval must be positive",
		},
		{
			"unparsable grace period", `"failingGracePeriod": "720h"`,
			`"failingGracePeriod": "30d"`,
			"parse orgDomainVerification.failingGracePeriod",
		},
		{
			"non-positive inconclusive retry", `"inconclusiveRetry": "1h"`,
			`"inconclusiveRetry": "0s"`,
			"orgDomainVerification.inconclusiveRetry must be positive",
		},
		{
			"non-positive inconclusive limit", `"inconclusiveLimit": "168h"`,
			`"inconclusiveLimit": "0s"`,
			"orgDomainVerification.inconclusiveLimit must be positive",
		},
		{
			"failure threshold zero", `"failureThreshold": 2`,
			`"failureThreshold": 0`,
			"orgDomainVerification.failureThreshold must be between 1 and 10",
		},
		{
			"failure threshold above ten", `"failureThreshold": 2`,
			`"failureThreshold": 11`,
			"orgDomainVerification.failureThreshold must be between 1 and 10",
		},
		{
			"retry equal to check interval", `"inconclusiveRetry": "1h"`,
			`"inconclusiveRetry": "168h"`,
			"inconclusiveRetry must be shorter than checkInterval",
		},
		{
			"unknown verification field", `"failureThreshold": 2,`,
			`"failureThreshold": 2, "bypass": true,`, "unknown field",
		},
		{
			"missing Org email timer", `"deliverOrgEmailTimer": "1s",`, ``,
			"missing workers.deliverOrgEmailTimer",
		},
		{
			"non-positive Org email lease", `"orgEmailLeaseTTL": "1m"`,
			`"orgEmailLeaseTTL": "0s"`,
			"workers.orgEmailLeaseTTL must be positive",
		},
		{
			"missing reconcile Org signup timer",
			`"reconcileOrgSignupTimer": "1m",`, ``,
			"missing workers.reconcileOrgSignupTimer",
		},
		{
			"non-positive verify timer", `"verifyOrgDomainsTimer": "1m"`,
			`"verifyOrgDomainsTimer": "0s"`,
			"workers.verifyOrgDomainsTimer must be positive",
		},
		{
			"Org email attempts zero", `"orgEmailMaxAttempts": 5`,
			`"orgEmailMaxAttempts": 0`,
			"workers.orgEmailMaxAttempts must be between 1 and 20",
		},
		{
			"Org email attempts above twenty", `"orgEmailMaxAttempts": 5`,
			`"orgEmailMaxAttempts": 21`,
			"workers.orgEmailMaxAttempts must be between 1 and 20",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			_, err := LoadFile(editConfig(t, test.old, test.replacement))
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf(
					"LoadFile() error = %v, want error containing %q",
					err, test.wantError,
				)
			}
		})
	}
}

func TestLoadFileAcceptsOrgBoundaryValues(t *testing.T) {
	t.Parallel()
	for _, test := range []struct{ old, replacement string }{
		{`"failureThreshold": 2`, `"failureThreshold": 1`},
		{`"failureThreshold": 2`, `"failureThreshold": 10`},
		{`"orgEmailMaxAttempts": 5`, `"orgEmailMaxAttempts": 1`},
		{`"orgEmailMaxAttempts": 5`, `"orgEmailMaxAttempts": 20`},
		{`"inconclusiveRetry": "1h"`, `"inconclusiveRetry": "167h59m"`},
		{
			`"resolverAddress": "dns-dev:53"`,
			`"resolverAddress": "1.1.1.1:53"`,
		},
		{
			`"resolverAddress": "dns-dev:53"`,
			`"resolverAddress": "[2606:4700:4700::1111]:53"`,
		},
	} {
		if _, err := LoadFile(
			editConfig(t, test.old, test.replacement),
		); err != nil {
			t.Errorf("LoadFile() with %s: %v", test.replacement, err)
		}
	}
}

func TestOrgsCredentialSecretUsesConfiguredFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "orgs-credential-key")
	if err := os.WriteFile(path, []byte("orgs-secret\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ORGS_CREDENTIAL_KEY_FILE", path)

	secret, err := OrgsCredentialSecret()
	if err != nil {
		t.Fatal(err)
	}
	if secret != "orgs-secret" {
		t.Fatalf("OrgsCredentialSecret() = %q, want trimmed secret", secret)
	}
}

func TestOrgsCredentialSecretRejectsEmptyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "orgs-credential-key")
	if err := os.WriteFile(path, []byte("\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ORGS_CREDENTIAL_KEY_FILE", path)

	_, err := OrgsCredentialSecret()
	if err == nil || !strings.Contains(err.Error(), "orgs credential key") {
		t.Fatalf("OrgsCredentialSecret() error = %v, want empty-file error", err)
	}
}

// editConfig writes the standard test configuration with one exact
// substitution, failing when the text to replace is absent so a template
// change cannot silently turn a negative test into a passing one.
func editConfig(t *testing.T, old, replacement string) string {
	t.Helper()
	path := writeConfig(t, "password-not-read", "")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(contents), old) != 1 {
		t.Fatalf("test configuration does not contain %q exactly once", old)
	}
	contents = []byte(strings.Replace(string(contents), old, replacement, 1))
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
