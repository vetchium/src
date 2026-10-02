package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	orgsauth "github.com/vetchium/src/typespec/orgs/auth"

	"backend/internal/service"
)

// devDNSAPIKey is fixed in the Compose files; it guards a loopback-only
// development server, not production data.
const devDNSAPIKey = "vetchium-dev-dns-api-key"

var (
	orgSignupTokenPattern = regexp.MustCompile(
		`complete-signup\?region=[a-z0-9-]+&token=([0-9a-f]{64})`,
	)
	orgRecordValuePattern = regexp.MustCompile(`vetchium-verify=[a-z2-7]{26}`)
)

type orgSeedSettings struct {
	orgsOrigin, mailpitOrigin, dnsOrigin, tenantID string
}

func loadOrgSeedSettings() (orgSeedSettings, error) {
	var s orgSeedSettings
	for name, target := range map[string]*string{
		"DEV_SEED_ORGS_ORIGIN": &s.orgsOrigin,
		"DEV_SEED_MAILPIT_URL": &s.mailpitOrigin,
		"DEV_SEED_DNS_URL":     &s.dnsOrigin,
		"DEV_SEED_TENANT":      &s.tenantID,
	} {
		value := strings.TrimSpace(os.Getenv(name))
		if value == "" {
			return orgSeedSettings{}, fmt.Errorf("missing %s", name)
		}
		*target = strings.TrimRight(value, "/")
	}
	return s, nil
}

// runOrgSeed signs one Org up per tenant through the same path a real
// requester follows: request signup, publish the TXT record from the DNS
// instructions email in the development DNS server, then complete signup
// from the private link. The Org's first superadmin uses the documented
// development password.
func runOrgSeed() error {
	settings, err := loadOrgSeedSettings()
	if err != nil {
		return err
	}
	ctx, stop := service.SignalContext()
	defer stop()
	domain := orgs.OrgDomain(settings.tenantID + ".example.com")
	email := "admin@" + string(domain)
	seeder := &orgSeeder{
		settings: settings,
		client:   &http.Client{Timeout: hubProfileRequestTimeout},
	}
	if err := seeder.post(
		ctx, "/api/orgs/request-signup", orgsauth.RequestSignupRequest{
			EmailAddress:      common.EmailAddress(email),
			PreferredLanguage: orgs.EnglishUnitedStates,
		}, http.StatusAccepted,
	); err != nil {
		return fmt.Errorf("request Org signup: %w", err)
	}
	dnsEmail, err := seeder.awaitEmail(ctx, email, "DNS record")
	if err != nil {
		return err
	}
	value := orgRecordValuePattern.Find(dnsEmail)
	if value == nil {
		return fmt.Errorf("DNS instructions carried no record value")
	}
	if err := seeder.publishRecord(ctx, domain, string(value)); err != nil {
		return err
	}
	linkEmail, err := seeder.awaitEmail(ctx, email, "Complete")
	if err != nil {
		return err
	}
	token := orgSignupTokenPattern.FindSubmatch(linkEmail)
	if token == nil {
		return fmt.Errorf("signup link email carried no token")
	}
	if err := seeder.post(
		ctx, "/api/orgs/complete-signup", orgsauth.CompleteSignupRequest{
			SignupToken:    orgsauth.OrgSignupToken(token[1]),
			OrgDisplayName: common.DisplayName("Example " + strings.ToUpper(settings.tenantID) + " Corp"),
			Password:       common.NewPassword(devSeedHubUserPassword),
		}, http.StatusCreated,
	); err != nil {
		return fmt.Errorf("complete Org signup: %w", err)
	}
	log.Printf("seeded Org domain=%s superadmin=%s", domain, email)
	return nil
}

type orgSeeder struct {
	settings orgSeedSettings
	client   *http.Client
}

func (s *orgSeeder) post(
	ctx context.Context, path string, body any, want int,
) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, s.settings.orgsOrigin+path,
		bytes.NewReader(payload),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", newIdempotencyKey())
	return s.do(request, want)
}

func (s *orgSeeder) publishRecord(
	ctx context.Context, domain orgs.OrgDomain, value string,
) error {
	payload, err := json.Marshal(map[string]any{
		"rrsets": []map[string]any{{
			"name": "_vetchium." + string(domain) + ".", "type": "TXT",
			"ttl": 60, "changetype": "REPLACE",
			"records": []map[string]any{
				{"content": `"` + value + `"`, "disabled": false},
			},
		}},
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPatch,
		s.settings.dnsOrigin+"/api/v1/servers/localhost/zones/example.com.",
		bytes.NewReader(payload),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-API-Key", devDNSAPIKey)
	if err := s.do(request, http.StatusNoContent); err != nil {
		return fmt.Errorf("publish development TXT record: %w", err)
	}
	return nil
}

func (s *orgSeeder) do(request *http.Request, want int) error {
	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != want {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<16))
		return fmt.Errorf("%s %s returned %d: %s",
			request.Method, request.URL.Path, response.StatusCode, body)
	}
	return nil
}

func (s *orgSeeder) awaitEmail(
	ctx context.Context, email, subject string,
) ([]byte, error) {
	mailbox := fmt.Sprintf(
		"%s/view/latest.txt?query=%s", s.settings.mailpitOrigin,
		url.QueryEscape(fmt.Sprintf("to:%s subject:%q", email, subject)),
	)
	deadline := time.Now().Add(mailpitPollTimeout)
	for {
		request, err := http.NewRequestWithContext(
			ctx, http.MethodGet, mailbox, nil,
		)
		if err != nil {
			return nil, err
		}
		if response, err := s.client.Do(request); err == nil {
			body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK && len(body) > 0 {
				return body, nil
			}
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("no %q email for %s within %s",
				subject, email, mailpitPollTimeout)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(mailpitPollInterval):
		}
	}
}
