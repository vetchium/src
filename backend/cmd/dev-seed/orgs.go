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
	aispec "github.com/vetchium/src/typespec/orgs/ai"
	orgsauth "github.com/vetchium/src/typespec/orgs/auth"
	"github.com/vetchium/src/typespec/orgs/authorization"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	orgsusers "github.com/vetchium/src/typespec/orgs/users"

	"backend/internal/service"
)

var (
	orgSignupTokenPattern = regexp.MustCompile(
		`complete-signup\?region=[a-z0-9-]+&token=([0-9a-f]{64})`,
	)
	orgInvitationTokenPattern = regexp.MustCompile(
		`accept-invitation\?region=[a-z0-9-]+&token=([A-Za-z0-9_-]+)`,
	)
)

type orgSeedSettings struct {
	orgsOrigin, mailpitOrigin, tenantID string
}

func loadOrgSeedSettings() (orgSeedSettings, error) {
	var s orgSeedSettings
	for name, target := range map[string]*string{
		"DEV_SEED_ORGS_ORIGIN": &s.orgsOrigin,
		"DEV_SEED_MAILPIT_URL": &s.mailpitOrigin,
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

// seededOrgCountries gives each tenant's fixtures a plausible base country;
// a real Org's country is unrelated to its tenant.
var seededOrgCountries = map[string]common.CountryCode{
	"sgp": "SG", "usa1": "US", "deu": "DE", "ind1": "IN",
}

// seededOrgDomain names a fixture Org by its kind and number in a tenant, such
// as org1.ind1.test for a hiring company or age1.ind1.test for an agency.
// Development tenants trust `.test` names without a DNS lookup
// (orgDomainVerification.trustReservedDomains), so no TXT record is needed.
func seededOrgDomain(kind string, number int, tenant string) orgs.OrgDomain {
	return orgs.OrgDomain(fmt.Sprintf("%s%d.%s.test", kind, number, tenant))
}

// hiringCompanyKind prefixes the hiring companies' domains.
const hiringCompanyKind = "org"

// seededOrgs are the hiring companies every tenant gets: one per plan, so
// every plan-gated screen has an Org to open.
var seededOrgs = []struct {
	number int
	label  string
	plan   subscriptionspec.Plan
}{
	{1, "Free", subscriptionspec.FreeTier},
	{2, "Silver", subscriptionspec.SilverTier},
	{3, "Gold", subscriptionspec.GoldTier},
}

func hiringCompanyName(tenant string, number int) string {
	return fmt.Sprintf("%s Hiring Co %d", strings.ToUpper(tenant), number)
}

type seededUser struct {
	local       string
	permissions []authorization.OrgPermissionID
}

// The requester is Superadmin; these invited users exercise the remaining
// account and Opening permissions.
var seededUsers = []seededUser{
	{"finance", []authorization.OrgPermissionID{authorization.OrgPermissionID(authorization.ManageBilling)}},
	{"users", []authorization.OrgPermissionID{authorization.OrgPermissionID(authorization.ManageUsers)}},
	{"recruiter", []authorization.OrgPermissionID{authorization.OrgPermissionID(authorization.ManageOpenings)}},
	{"approver", []authorization.OrgPermissionID{authorization.OrgPermissionID(authorization.ApproveOpenings)}},
	{"member", nil},
}

// runOrgSeed creates a hiring company per plan through the same paths a real
// requester follows: request signup, complete it from the private link, sign
// in, choose the plan against a simulated card, and invite one user per role
// preset. Every user has the documented development password.
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
	country, ok := seededOrgCountries[settings.tenantID]
	if !ok {
		return fmt.Errorf("no seeded Org country for tenant %q", settings.tenantID)
	}
	for _, org := range seededOrgs {
		domain := seededOrgDomain(hiringCompanyKind, org.number, settings.tenantID)
		displayName := hiringCompanyName(settings.tenantID, org.number)
		if err := seeder.seedOrg(ctx, domain, displayName, country, org.plan); err != nil {
			return fmt.Errorf("seed %s Org %s: %w", org.label, domain, err)
		}
	}
	return nil
}

// signupOrg signs an Org up at origin as admin@domain, the requester and
// first superadmin, puts it on plan, and returns the admin's session.
func (s *orgSeeder) signupOrg(
	ctx context.Context, origin string, domain orgs.OrgDomain, displayName string,
	country common.CountryCode, plan subscriptionspec.Plan,
) (string, error) {
	email := "admin@" + string(domain)
	if err := s.postAt(
		ctx, origin, "/api/orgs/request-signup", orgsauth.RequestSignupRequest{
			EmailAddress:      common.EmailAddress(email),
			PreferredLanguage: orgs.EnglishUnitedStates,
		}, "", http.StatusAccepted, nil,
	); err != nil {
		return "", fmt.Errorf("request Org signup: %w", err)
	}
	linkEmail, err := s.awaitEmail(ctx, email, "Complete")
	if err != nil {
		return "", err
	}
	token := orgSignupTokenPattern.FindSubmatch(linkEmail)
	if token == nil {
		return "", fmt.Errorf("signup link email carried no token")
	}
	if err := s.postAt(
		ctx, origin, "/api/orgs/complete-signup", orgsauth.CompleteSignupRequest{
			SignupToken:          orgsauth.OrgSignupToken(token[1]),
			OrgDisplayName:       common.DisplayName(displayName),
			OrgCountry:           country,
			AcceptedTermsVersion: orgsauth.CurrentTermsVersion,
			Password:             common.NewPassword(devSeedHubUserPassword),
		}, "", http.StatusCreated, nil,
	); err != nil {
		return "", fmt.Errorf("complete Org signup: %w", err)
	}
	var session orgsauth.LoginAuthenticatedResponse
	if err := s.postAt(
		ctx, origin, "/api/orgs/login", orgsauth.LoginRequest{
			Domain:       domain,
			EmailAddress: common.EmailAddress(email),
			Password:     common.Password(devSeedHubUserPassword),
		}, "", http.StatusOK, &session,
	); err != nil {
		return "", fmt.Errorf("sign in: %w", err)
	}
	bearer := string(session.SessionToken)
	if plan != subscriptionspec.FreeTier {
		if err := s.postAt(
			ctx, origin, "/api/orgs/set-subscription-plan",
			subscriptionspec.SetSubscriptionPlanRequest{
				PlanOID: plan,
				BillingInterval: subscriptionspec.OptionalBillingInterval{
					Value: subscriptionspec.Month, Present: true,
				},
			}, bearer, http.StatusOK, nil,
		); err != nil {
			return "", fmt.Errorf("choose %s: %w", plan, err)
		}
	}
	return bearer, nil
}

// inviteUsers invites each user to the Org at domain and accepts the
// invitation from the email Mailpit captured, with the development password.
func (s *orgSeeder) inviteUsers(
	ctx context.Context, origin, bearer string, domain orgs.OrgDomain, users []seededUser,
) error {
	for _, user := range users {
		address := user.local + "@" + string(domain)
		if err := s.postAt(
			ctx, origin, "/api/orgs/invite-users", orgsusers.InviteUsersRequest{
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
		if err := s.postAt(
			ctx, origin, "/api/orgs/accept-invitation", orgsusers.AcceptInvitationRequest{
				InvitationToken:   orgsusers.OrgInvitationToken(invited[1]),
				Password:          common.NewPassword(devSeedHubUserPassword),
				PreferredLanguage: orgs.EnglishUnitedStates,
			}, "", http.StatusCreated, nil,
		); err != nil {
			return fmt.Errorf("accept the invitation of %s: %w", address, err)
		}
	}
	return nil
}

func (s *orgSeeder) seedOrg(
	ctx context.Context, domain orgs.OrgDomain, displayName string,
	country common.CountryCode, plan subscriptionspec.Plan,
) error {
	email := "admin@" + string(domain)
	bearer, err := s.signupOrg(ctx, s.settings.orgsOrigin, domain, displayName, country, plan)
	if err != nil {
		return err
	}
	users := []seededUser{}
	for _, user := range seededUsers {
		// The Free plan's five seats hold the admin and four invitees.
		if plan != subscriptionspec.FreeTier || user.local != "member" {
			users = append(users, user)
		}
	}
	if err := s.inviteUsers(ctx, s.settings.orgsOrigin, bearer, domain, users); err != nil {
		return err
	}
	if subscriptionspec.AllowsAI(plan) {
		if err := s.seedOrgAI(ctx, bearer); err != nil {
			return fmt.Errorf("seed AI: %w", err)
		}
	}
	if err := s.seedOrgOpenings(ctx, domain, bearer); err != nil {
		return fmt.Errorf("seed Openings: %w", err)
	}
	locals := make([]string, 0, len(users))
	for _, user := range users {
		locals = append(locals, user.local)
	}
	log.Printf("seeded %s Org domain=%s superadmin=%s users=%s openings=10 ai=%t",
		plan, domain, email, strings.Join(locals, ","), subscriptionspec.AllowsAI(plan))
	return nil
}

// seedOrgAI turns AI on with every offered model allowed and buys the
// region's first credit pack, as the Org's superadmin would.
func (s *orgSeeder) seedOrgAI(ctx context.Context, bearer string) error {
	terms := aispec.OrgAITermsVersion
	if err := s.post(
		ctx, "/api/orgs/set-ai-settings", aispec.SetAISettingsRequest{
			Enabled: true, AcceptTermsVersion: &terms,
			Policies: []aispec.AIOperationPolicy{},
		}, bearer, http.StatusOK, nil,
	); err != nil {
		return fmt.Errorf("turn AI on: %w", err)
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodGet, s.settings.orgsOrigin+"/api/orgs/ai-credits", nil,
	)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+bearer)
	var credits aispec.AICreditsResponse
	if err := s.do(request, http.StatusOK, &credits); err != nil {
		return fmt.Errorf("read AI credits: %w", err)
	}
	if len(credits.Packs) == 0 {
		return nil
	}
	if err := s.post(
		ctx, "/api/orgs/buy-ai-credit-pack", aispec.BuyAICreditPackRequest{
			PackID: credits.Packs[0].PackID,
		}, bearer, http.StatusOK, nil,
	); err != nil {
		return fmt.Errorf("buy AI credits: %w", err)
	}
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
	return s.postAt(ctx, s.settings.orgsOrigin, path, body, bearer, want, out)
}

// postAt is post against another API origin, such as a Hub region.
func (s *orgSeeder) postAt(
	ctx context.Context, origin, path string, body any, bearer string,
	want int, out any,
) error {
	return s.postAtWithKey(ctx, origin, path, body, bearer, newIdempotencyKey(), want, out)
}

// postAtWithKey is postAt with a caller-chosen Idempotency-Key, so a retry
// of a write whose outcome is unknown replays instead of applying twice.
func (s *orgSeeder) postAtWithKey(
	ctx context.Context, origin, path string, body any, bearer, key string,
	want int, out any,
) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, origin+path, bytes.NewReader(payload),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", key)
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	return s.do(request, want, out)
}

func (s *orgSeeder) do(request *http.Request, want int, out any) error {
	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != want {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<16))
		return &statusError{
			status: response.StatusCode,
			text: fmt.Sprintf("%s %s returned %d: %s",
				request.Method, request.URL.Path, response.StatusCode, body),
		}
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(out)
}

// statusError is an answer other than the one a seed step expected.
type statusError struct {
	status int
	text   string
}

func (e *statusError) Error() string { return e.text }

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
