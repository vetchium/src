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
	"github.com/vetchium/src/typespec/orgs/authorization"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	orgsusers "github.com/vetchium/src/typespec/orgs/users"

	"backend/internal/service"
)

// devDNSAPIKey is fixed in the Compose files; it guards a loopback-only
// development server, not production data.
const devDNSAPIKey = "vetchium-dev-dns-api-key"

var (
	orgSignupTokenPattern = regexp.MustCompile(
		`complete-signup\?region=[a-z0-9-]+&token=([0-9a-f]{64})`,
	)
	orgRecordValuePattern     = regexp.MustCompile(`vetchium-verify=[a-z2-7]{26}`)
	orgInvitationTokenPattern = regexp.MustCompile(
		`accept-invitation\?region=[a-z0-9-]+&token=([A-Za-z0-9_-]+)`,
	)
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

// seededOrgs are the Orgs every tenant gets: one per plan, so every plan-gated
// screen has an Org to open. The Free Org keeps the tenant's own domain.
var seededOrgs = []struct {
	label, domainPrefix string
	plan                subscriptionspec.Plan
}{
	{"Free", "", subscriptionspec.FreeTier},
	{"Silver", "silver.", subscriptionspec.SilverTier},
	{"Gold", "gold.", subscriptionspec.GoldTier},
}

// seededUsers hold the role presets of the Orgs portal (the first, the
// requester, is the Superadmin preset).
var seededUsers = []struct {
	local       string
	permissions []authorization.OrgPermissionID
}{
	{"finance", []authorization.OrgPermissionID{authorization.OrgPermissionID(authorization.ManageBilling)}},
	{"users", []authorization.OrgPermissionID{authorization.OrgPermissionID(authorization.ManageUsers)}},
	{"member", nil},
}

// runOrgSeed creates an Org per plan through the same paths a real requester
// follows: request signup, publish the TXT record from the DNS instructions
// email in the development DNS server, complete signup from the private link,
// sign in, choose the plan against a simulated card, and invite one user per
// role preset. Every user has the documented development password.
func runOrgSeed() error {
	settings, err := loadOrgSeedSettings()
	if err != nil {
		return err
	}
	ctx, stop := service.SignalContext()
	defer stop()
	seeder := &orgSeeder{
		settings: settings,
		client:   &http.Client{Timeout: hubProfileRequestTimeout},
	}
	for _, org := range seededOrgs {
		domain := orgs.OrgDomain(org.domainPrefix + settings.tenantID + ".example.com")
		displayName := fmt.Sprintf(
			"Example %s %s Corp", strings.ToUpper(settings.tenantID), org.label,
		)
		if err := seeder.seedOrg(ctx, domain, displayName, org.plan); err != nil {
			return fmt.Errorf("seed %s Org %s: %w", org.label, domain, err)
		}
	}
	return nil
}

func (s *orgSeeder) seedOrg(
	ctx context.Context, domain orgs.OrgDomain, displayName string,
	plan subscriptionspec.Plan,
) error {
	email := "admin@" + string(domain)
	if err := s.post(
		ctx, "/api/orgs/request-signup", orgsauth.RequestSignupRequest{
			EmailAddress:      common.EmailAddress(email),
			PreferredLanguage: orgs.EnglishUnitedStates,
		}, "", http.StatusAccepted, nil,
	); err != nil {
		return fmt.Errorf("request Org signup: %w", err)
	}
	dnsEmail, err := s.awaitEmail(ctx, email, "DNS record")
	if err != nil {
		return err
	}
	value := orgRecordValuePattern.Find(dnsEmail)
	if value == nil {
		return fmt.Errorf("DNS instructions carried no record value")
	}
	if err := s.publishRecord(ctx, domain, string(value)); err != nil {
		return err
	}
	linkEmail, err := s.awaitEmail(ctx, email, "Complete")
	if err != nil {
		return err
	}
	token := orgSignupTokenPattern.FindSubmatch(linkEmail)
	if token == nil {
		return fmt.Errorf("signup link email carried no token")
	}
	if err := s.post(
		ctx, "/api/orgs/complete-signup", orgsauth.CompleteSignupRequest{
			SignupToken:    orgsauth.OrgSignupToken(token[1]),
			OrgDisplayName: common.DisplayName(displayName),
			Password:       common.NewPassword(devSeedHubUserPassword),
		}, "", http.StatusCreated, nil,
	); err != nil {
		return fmt.Errorf("complete Org signup: %w", err)
	}

	var session orgsauth.LoginAuthenticatedResponse
	if err := s.post(
		ctx, "/api/orgs/login", orgsauth.LoginRequest{
			Domain:       domain,
			EmailAddress: common.EmailAddress(email),
			Password:     common.Password(devSeedHubUserPassword),
		}, "", http.StatusOK, &session,
	); err != nil {
		return fmt.Errorf("sign in: %w", err)
	}
	bearer := string(session.SessionToken)
	if plan != subscriptionspec.FreeTier {
		if err := s.post(
			ctx, "/api/orgs/set-subscription-plan",
			subscriptionspec.SetSubscriptionPlanRequest{
				PlanOID: plan,
				BillingInterval: subscriptionspec.OptionalBillingInterval{
					Value: subscriptionspec.Month, Present: true,
				},
			}, bearer, http.StatusOK, nil,
		); err != nil {
			return fmt.Errorf("choose %s: %w", plan, err)
		}
	}
	for _, user := range seededUsers {
		address := user.local + "@" + string(domain)
		if err := s.post(
			ctx, "/api/orgs/invite-users", orgsusers.InviteUsersRequest{
				EmailAddresses: []orgsusers.InviteeAddress{
					orgsusers.InviteeAddress(address),
				},
				Permissions: user.permissions,
			}, bearer, http.StatusOK, nil,
		); err != nil {
			return fmt.Errorf("invite %s: %w", address, err)
		}
		invitation, err := s.awaitEmail(ctx, address, "invited to join")
		if err != nil {
			return err
		}
		invited := orgInvitationTokenPattern.FindSubmatch(invitation)
		if invited == nil {
			return fmt.Errorf("invitation email carried no token")
		}
		if err := s.post(
			ctx, "/api/orgs/accept-invitation", orgsusers.AcceptInvitationRequest{
				InvitationToken:   orgsusers.OrgInvitationToken(invited[1]),
				Password:          common.NewPassword(devSeedHubUserPassword),
				PreferredLanguage: orgs.EnglishUnitedStates,
			}, "", http.StatusCreated, nil,
		); err != nil {
			return fmt.Errorf("accept the invitation of %s: %w", address, err)
		}
	}
	log.Printf("seeded %s Org domain=%s superadmin=%s users=finance,users,member",
		plan, domain, email)
	return nil
}

type orgSeeder struct {
	settings orgSeedSettings
	client   *http.Client
}

// post sends a JSON request, with a bearer token when one is given, and
// decodes the response into out when out is not nil.
func (s *orgSeeder) post(
	ctx context.Context, path string, body any, bearer string, want int,
	out any,
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
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	return s.do(request, want, out)
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
	if err := s.do(request, http.StatusNoContent, nil); err != nil {
		return fmt.Errorf("publish development TXT record: %w", err)
	}
	return nil
}

func (s *orgSeeder) do(request *http.Request, want int, out any) error {
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
	if out == nil {
		return nil
	}
	return json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(out)
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
