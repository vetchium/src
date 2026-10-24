package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	hubapplications "github.com/vetchium/src/typespec/hub/applications"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	hubmessages "github.com/vetchium/src/typespec/hub/messages"
	hubprofile "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
	orgapplications "github.com/vetchium/src/typespec/orgs/applications"
	orgsauth "github.com/vetchium/src/typespec/orgs/auth"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/orgs/openings"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/service"
)

var marketplaceSeedTenants = []string{"sgp", "usa1", "deu", "ind1"}

type marketplaceSeedSettings struct {
	orgsOrigins map[string]string
	hubOrigins  map[string]string
	dnsOrigin   string
	mailpitURL  string
	profilesDir string
	tenantID    string
}

func loadMarketplaceSeedSettings() (marketplaceSeedSettings, error) {
	var s marketplaceSeedSettings
	s.tenantID = strings.TrimSpace(os.Getenv("DEV_SEED_TENANT"))
	s.dnsOrigin = strings.TrimRight(strings.TrimSpace(os.Getenv("DEV_SEED_DNS_URL")), "/")
	if s.dnsOrigin == "" {
		s.dnsOrigin = "http://127.0.0.1:18081"
	}
	s.mailpitURL = strings.TrimRight(strings.TrimSpace(os.Getenv("DEV_SEED_MAILPIT_URL")), "/")
	if s.mailpitURL == "" {
		s.mailpitURL = "http://127.0.0.1:18025"
	}
	s.profilesDir = strings.TrimRight(strings.TrimSpace(os.Getenv("DEV_SEED_HUB_PROFILES_DIR")), "/")
	if s.profilesDir == "" {
		s.profilesDir = "dev/hub-seed-profiles"
	}

	s.orgsOrigins = map[string]string{}
	for _, pair := range strings.Split(os.Getenv("DEV_SEED_ORGS_ORIGINS"), ",") {
		tenant, origin, ok := strings.Cut(strings.TrimSpace(pair), "=")
		if ok && tenant != "" && origin != "" {
			s.orgsOrigins[tenant] = strings.TrimRight(origin, "/")
		}
	}
	if single := strings.TrimRight(strings.TrimSpace(os.Getenv("DEV_SEED_ORGS_ORIGIN")), "/"); single != "" && s.tenantID != "" {
		s.orgsOrigins[s.tenantID] = single
	}

	s.hubOrigins = map[string]string{}
	for _, pair := range strings.Split(os.Getenv("DEV_SEED_HUB_ORIGINS"), ",") {
		tenant, origin, ok := strings.Cut(strings.TrimSpace(pair), "=")
		if ok && tenant != "" && origin != "" {
			s.hubOrigins[tenant] = strings.TrimRight(origin, "/")
		}
	}

	for _, tenant := range marketplaceSeedTenants {
		if s.orgsOrigins[tenant] == "" {
			s.orgsOrigins[tenant] = fmt.Sprintf("http://%s.api.vetchium.localhost", tenant)
		}
		if s.hubOrigins[tenant] == "" {
			s.hubOrigins[tenant] = fmt.Sprintf("http://%s.api.vetchium.localhost", tenant)
		}
	}
	return s, nil
}

type providerCapabilitySpec struct {
	capability marketplace.Capability
	prefix     string
	title      string
	headline   string
	desc       string
	price      string
	checkTypes []hiring.CheckType
	disclosure *string
}

var providerCapabilitySpecs = []providerCapabilitySpec{
	{
		capability: marketplace.Sourcing,
		prefix:     "agency.",
		title:      "Example %s Sourcing Agency",
		headline:   "Specialized Talent Sourcing",
		desc:       "Executive search and tech talent sourcing across global markets.",
		price:      "Success fee or retainer",
	},
	{
		capability: marketplace.Interviewing,
		prefix:     "interviews.",
		title:      "Example %s Technical Interviews",
		headline:   "Standardized Technical Interviews",
		desc:       "Live technical interviews and coding panels conducted by senior engineers.",
		price:      "Quoted per interview session",
	},
	{
		capability: marketplace.Assessment,
		prefix:     "assessments.",
		title:      "Example %s Skill Assessments",
		headline:   "Real-World Coding Assessments",
		desc:       "Standardized take-home evaluations and automated coding assessments.",
		price:      "Per candidate test",
	},
	{
		capability: marketplace.BackgroundCheck,
		prefix:     "checks.",
		title:      "Example %s Background Verification",
		headline:   "Comprehensive Background Checks",
		desc:       "Identity, education, and employment credential verification.",
		price:      "Tiered check packages",
		checkTypes: []hiring.CheckType{
			hiring.IdentityCheck,
			hiring.EducationCheck,
			hiring.EmploymentCheck,
		},
		disclosure: ptr("We verify identity, education, and previous employment credentials."),
	},
}

func ptr[T any](v T) *T { return &v }

type marketplaceHubUserSession struct {
	origin, token, handle string
}

type marketplaceSeeder struct {
	*orgSeeder
	settings    marketplaceSeedSettings
	orgTokens   map[string]string
	hubSessions map[string]marketplaceHubUserSession
}

func runMarketplaceSeed() error {
	settings, err := loadMarketplaceSeedSettings()
	if err != nil {
		return err
	}
	ctx, stop := service.SignalContext()
	defer stop()

	seeder := &marketplaceSeeder{
		orgSeeder: &orgSeeder{
			settings: orgSeedSettings{
				dnsOrigin:     settings.dnsOrigin,
				mailpitOrigin: settings.mailpitURL,
			},
			client: &http.Client{Timeout: 30 * time.Second},
		},
		settings:    settings,
		orgTokens:   map[string]string{},
		hubSessions: map[string]marketplaceHubUserSession{},
	}

	tenantsToSeed := marketplaceSeedTenants
	if settings.tenantID != "" {
		tenantsToSeed = []string{settings.tenantID}
	}

	for _, tenant := range tenantsToSeed {
		if err := seeder.seedTenant(ctx, tenant); err != nil {
			return fmt.Errorf("seed marketplace for tenant %s: %w", tenant, err)
		}
	}
	return nil
}

func (s *marketplaceSeeder) orgLogin(ctx context.Context, tenant string, domain orgs.OrgDomain) (string, error) {
	key := string(domain)
	if tok, ok := s.orgTokens[key]; ok {
		return tok, nil
	}
	email := "admin@" + string(domain)
	origin := s.settings.orgsOrigins[tenant]
	var session orgsauth.LoginAuthenticatedResponse
	err := s.postAt(
		ctx, origin, "/api/orgs/login", orgsauth.LoginRequest{
			Domain:       domain,
			EmailAddress: common.EmailAddress(email),
			Password:     common.Password(devSeedHubUserPassword),
		}, "", http.StatusOK, &session,
	)
	if err != nil {
		return "", err
	}
	tok := string(session.SessionToken)
	s.orgTokens[key] = tok
	return tok, nil
}

func (s *marketplaceSeeder) signupProviderOrg(
	ctx context.Context, tenant string, domain orgs.OrgDomain, displayName string,
) (string, error) {
	email := "admin@" + string(domain)
	origin := s.settings.orgsOrigins[tenant]
	if err := s.postAt(
		ctx, origin, "/api/orgs/request-signup", orgsauth.RequestSignupRequest{
			EmailAddress:      common.EmailAddress(email),
			PreferredLanguage: orgs.EnglishUnitedStates,
		}, "", http.StatusAccepted, nil,
	); err != nil {
		return "", fmt.Errorf("request signup: %w", err)
	}
	dnsEmail, err := s.awaitEmail(ctx, email, "DNS record")
	if err != nil {
		return "", err
	}
	value := orgRecordValuePattern.Find(dnsEmail)
	if value == nil {
		return "", fmt.Errorf("DNS instructions carried no record value")
	}
	if err := s.publishRecord(ctx, domain, string(value)); err != nil {
		return "", err
	}
	linkEmail, err := s.awaitEmail(ctx, email, "Complete")
	if err != nil {
		return "", err
	}
	token := orgSignupTokenPattern.FindSubmatch(linkEmail)
	if token == nil {
		return "", fmt.Errorf("signup link email carried no token")
	}
	country, ok := seededOrgCountries[tenant]
	if !ok {
		country = "US"
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
		return "", fmt.Errorf("complete signup: %w", err)
	}
	var session orgsauth.LoginAuthenticatedResponse
	if err := s.postAt(
		ctx, origin, "/api/orgs/login", orgsauth.LoginRequest{
			Domain:       domain,
			EmailAddress: common.EmailAddress(email),
			Password:     common.Password(devSeedHubUserPassword),
		}, "", http.StatusOK, &session,
	); err != nil {
		return "", fmt.Errorf("login: %w", err)
	}
	bearer := string(session.SessionToken)
	s.orgTokens[string(domain)] = bearer
	if err := s.postAt(
		ctx, origin, "/api/orgs/set-subscription-plan", subscriptionspec.SetSubscriptionPlanRequest{
			PlanOID: subscriptionspec.SilverTier,
			BillingInterval: subscriptionspec.OptionalBillingInterval{
				Value: subscriptionspec.Month, Present: true,
			},
		}, bearer, http.StatusOK, nil,
	); err != nil {
		return "", fmt.Errorf("choose plan: %w", err)
	}
	return bearer, nil
}

func (s *marketplaceSeeder) orgPost(
	ctx context.Context, tenant string, domain orgs.OrgDomain, path string, body any, want int, out any,
) error {
	bearer, err := s.orgLogin(ctx, tenant, domain)
	if err != nil {
		return fmt.Errorf("login to %s: %w", domain, err)
	}
	origin := s.settings.orgsOrigins[tenant]
	return s.postAt(ctx, origin, "/api/orgs/"+path, body, bearer, want, out)
}

func (s *marketplaceSeeder) hubLogin(
	ctx context.Context, tenant, email string,
) (marketplaceHubUserSession, error) {
	if sess, ok := s.hubSessions[email]; ok {
		return sess, nil
	}
	origin := s.settings.hubOrigins[tenant]
	var resp hubauth.LoginAuthenticatedResponse
	if err := s.postAt(
		ctx, origin, "/api/hub/login", hubauth.LoginRequest{
			EmailAddress: common.EmailAddress(email),
			Password:     common.Password(devSeedHubUserPassword),
		}, "", http.StatusOK, &resp,
	); err != nil {
		return marketplaceHubUserSession{}, fmt.Errorf("hub login %s: %w", email, err)
	}
	sess := marketplaceHubUserSession{
		origin: origin,
		token:  string(resp.SessionToken),
		handle: string(resp.Handle),
	}
	s.hubSessions[email] = sess
	return sess, nil
}

func (s *marketplaceSeeder) hubPost(
	ctx context.Context, tenant, email, path string, body any, want int, out any,
) error {
	sess, err := s.hubLogin(ctx, tenant, email)
	if err != nil {
		return err
	}
	return s.postAt(ctx, sess.origin, "/api/hub/"+path, body, sess.token, want, out)
}

func (s *marketplaceSeeder) ensureProvider(
	ctx context.Context, tenant string, spec providerCapabilitySpec,
) (orgs.OrgDomain, error) {
	domain := orgs.OrgDomain(spec.prefix + tenant + ".example.com")
	bearer, err := s.orgLogin(ctx, tenant, domain)
	if err != nil {
		displayName := fmt.Sprintf(spec.title, strings.ToUpper(tenant))
		bearer, err = s.signupProviderOrg(ctx, tenant, domain, displayName)
		if err != nil {
			return "", fmt.Errorf("ensure provider org %s: %w", domain, err)
		}
	}

	var existing marketplace.Listing
	err = s.postAt(
		ctx, s.settings.orgsOrigins[tenant], "/api/orgs/get-listing",
		marketplace.GetListingRequest{
			Domain:     domain,
			Capability: spec.capability,
		}, bearer, http.StatusOK, &existing,
	)
	if err == nil && existing.State == marketplace.ListedListing {
		return domain, nil
	}

	req := marketplace.CreateListingRequest{
		Capability: spec.capability,
		ListingContent: marketplace.ListingContent{
			Headline:          spec.headline,
			Description:       spec.desc,
			Service:           marketplace.ServiceArea{Worldwide: true},
			Languages:         []common.LanguageTag{"en"},
			IndicativePrice:   &spec.price,
			CheckTypes:        spec.checkTypes,
			ConsentDisclosure: spec.disclosure,
		},
	}
	var created marketplace.Listing
	if err := s.postAt(
		ctx, s.settings.orgsOrigins[tenant], "/api/orgs/create-listing",
		req, bearer, http.StatusCreated, &created,
	); err != nil {
		// If listing already exists in draft, get its version
		if getErr := s.postAt(
			ctx, s.settings.orgsOrigins[tenant], "/api/orgs/get-listing",
			marketplace.GetListingRequest{Domain: domain, Capability: spec.capability},
			bearer, http.StatusOK, &created,
		); getErr != nil {
			return "", fmt.Errorf("create listing on %s: %w", domain, err)
		}
	}

	var published marketplace.Listing
	if err := s.postAt(
		ctx, s.settings.orgsOrigins[tenant], "/api/orgs/publish-listing",
		marketplace.ListingTarget{
			Capability: spec.capability,
			Version:    created.Version,
		}, bearer, http.StatusOK, &published,
	); err != nil {
		return "", fmt.Errorf("publish listing on %s: %w", domain, err)
	}
	return domain, nil
}

func (s *marketplaceSeeder) awaitClientEngagement(
	ctx context.Context, tenant string, domain orgs.OrgDomain, id marketplace.EngagementID,
) (marketplace.Engagement, error) {
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		var eng marketplace.Engagement
		err := s.orgPost(
			ctx, tenant, domain, "get-client-engagement",
			marketplace.GetEngagementRequest{EngagementID: id}, http.StatusOK, &eng,
		)
		if err == nil {
			return eng, nil
		}
		select {
		case <-ctx.Done():
			return marketplace.Engagement{}, ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	return marketplace.Engagement{}, fmt.Errorf("timeout waiting for client engagement %s on %s", id, domain)
}

func (s *marketplaceSeeder) awaitWorkItem(
	ctx context.Context, tenant string, domain orgs.OrgDomain, engagementID marketplace.EngagementID,
) (work.WorkItem, error) {
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		var resp work.ListWorkQueueResponse
		err := s.orgPost(
			ctx, tenant, domain, "list-work-queue",
			work.ListWorkQueueRequest{}, http.StatusOK, &resp,
		)
		if err == nil {
			for _, item := range resp.Items {
				if item.EngagementID == engagementID {
					return item, nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return work.WorkItem{}, ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	return work.WorkItem{}, fmt.Errorf("timeout waiting for work item on %s for engagement %s", domain, engagementID)
}

func (s *marketplaceSeeder) awaitHubConversation(
	ctx context.Context, tenant, email string, contactID contacts.ContactID,
) (hubmessages.HubConversationDetail, error) {
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		var detail hubmessages.HubConversationDetail
		err := s.hubPost(
			ctx, tenant, email, "get-conversation",
			hubmessages.GetConversationRequest{ContactID: contactID}, http.StatusOK, &detail,
		)
		if err == nil && detail.Conversation.HasConversation {
			return detail, nil
		}
		select {
		case <-ctx.Done():
			return hubmessages.HubConversationDetail{}, ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	return hubmessages.HubConversationDetail{}, fmt.Errorf("timeout waiting for Hub conversation %s for %s", contactID, email)
}

func (s *marketplaceSeeder) readProfileUsers(tenant string) ([]string, error) {
	path := filepath.Join(s.settings.profilesDir, tenant+".json")
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	var fixture struct {
		Users []struct {
			Email string `json:"email"`
		} `json:"users"`
	}
	if err := json.NewDecoder(file).Decode(&fixture); err != nil {
		return nil, err
	}
	emails := make([]string, len(fixture.Users))
	for i, u := range fixture.Users {
		emails[i] = u.Email
	}
	return emails, nil
}

func (s *marketplaceSeeder) seedTenant(ctx context.Context, tenant string) error {
	var tenantIndex int
	for i, t := range marketplaceSeedTenants {
		if t == tenant {
			tenantIndex = i
			break
		}
	}
	other1 := marketplaceSeedTenants[(tenantIndex+1)%len(marketplaceSeedTenants)]
	other2 := marketplaceSeedTenants[(tenantIndex+2)%len(marketplaceSeedTenants)]
	other3 := marketplaceSeedTenants[(tenantIndex+3)%len(marketplaceSeedTenants)]

	// 1. Ensure provider Orgs per Capability with published Listings
	providers := map[marketplace.Capability]orgs.OrgDomain{}
	for _, spec := range providerCapabilitySpecs {
		domain, err := s.ensureProvider(ctx, tenant, spec)
		if err != nil {
			return fmt.Errorf("ensure provider %s: %w", spec.capability, err)
		}
		providers[spec.capability] = domain
	}

	agencyDomain := providers[marketplace.Sourcing]
	interviewsDomain := providers[marketplace.Interviewing]
	assessmentsDomain := providers[marketplace.Assessment]
	checksDomain := providers[marketplace.BackgroundCheck]

	consumer1Domain := orgs.OrgDomain("gold." + other1 + ".example.com")
	consumer2Domain := orgs.OrgDomain("gold." + other2 + ".example.com")
	consumer3Domain := orgs.OrgDomain("silver." + other3 + ".example.com")

	// 2. Engagements in each state with consumers in other regions
	// 2a. Active engagements (all 4 capabilities with Consumer 1)
	activeEngagements := map[marketplace.Capability]marketplace.Engagement{}
	for cap, pDomain := range map[marketplace.Capability]orgs.OrgDomain{
		marketplace.Sourcing:        agencyDomain,
		marketplace.Interviewing:    interviewsDomain,
		marketplace.Assessment:      assessmentsDomain,
		marketplace.BackgroundCheck: checksDomain,
	} {
		var proposed marketplace.Engagement
		err := s.orgPost(
			ctx, other1, consumer1Domain, "propose-engagement",
			marketplace.ProposeEngagementRequest{
				ProviderDomain: pDomain,
				Capability:     cap,
				Message:        ptr(fmt.Sprintf("Partnering with %s for %s", pDomain, cap)),
			}, http.StatusCreated, &proposed,
		)
		if err != nil {
			var listResp marketplace.ListEngagementsResponse
			_ = s.orgPost(
				ctx, other1, consumer1Domain, "list-engagements",
				marketplace.ListEngagementsRequest{Capability: &cap}, http.StatusOK, &listResp,
			)
			for _, item := range listResp.Engagements {
				if item.Counterparty.Domain == pDomain {
					proposed = item
					break
				}
			}
		}

		if proposed.ID == "" {
			return fmt.Errorf("propose engagement on %s for %s: %w", consumer1Domain, cap, err)
		}

		if proposed.State != marketplace.ActiveEngagement {
			clientEng, waitErr := s.awaitClientEngagement(ctx, tenant, pDomain, proposed.ID)
			if waitErr != nil {
				return waitErr
			}
			var accepted marketplace.Engagement
			if err := s.orgPost(
				ctx, tenant, pDomain, "accept-engagement",
				marketplace.EngagementTarget{EngagementID: clientEng.ID, Version: clientEng.Version},
				http.StatusOK, &accepted,
			); err != nil && !errors.Is(err, context.Canceled) {
				return fmt.Errorf("accept engagement %s: %w", proposed.ID, err)
			}
			activeEngagements[cap] = accepted
		} else {
			activeEngagements[cap] = proposed
		}
	}

	// 2b. Proposed engagement (Consumer 2 proposes to agency, left proposed)
	var proposedEng marketplace.Engagement
	_ = s.orgPost(
		ctx, other2, consumer2Domain, "propose-engagement",
		marketplace.ProposeEngagementRequest{
			ProviderDomain: agencyDomain,
			Capability:     marketplace.Sourcing,
			Message:        ptr("Inquiry regarding technical recruitment capacity."),
		}, http.StatusCreated, &proposedEng,
	)

	// 2c. Declined engagement (Consumer 3 proposes to interviews, provider declines)
	var declinedEng marketplace.Engagement
	if err := s.orgPost(
		ctx, other3, consumer3Domain, "propose-engagement",
		marketplace.ProposeEngagementRequest{
			ProviderDomain: interviewsDomain,
			Capability:     marketplace.Interviewing,
			Message:        ptr("Requesting interviewer staff for Q4."),
		}, http.StatusCreated, &declinedEng,
	); err == nil {
		clientEng, waitErr := s.awaitClientEngagement(ctx, tenant, interviewsDomain, declinedEng.ID)
		if waitErr == nil {
			_ = s.orgPost(
				ctx, tenant, interviewsDomain, "decline-engagement",
				marketplace.EngagementTarget{EngagementID: clientEng.ID, Version: clientEng.Version},
				http.StatusOK, nil,
			)
		}
	}

	// 2d. Withdrawn engagement (Consumer 2 proposes to assessments, consumer withdraws)
	var withdrawnEng marketplace.Engagement
	if err := s.orgPost(
		ctx, other2, consumer2Domain, "propose-engagement",
		marketplace.ProposeEngagementRequest{
			ProviderDomain: assessmentsDomain,
			Capability:     marketplace.Assessment,
			Message:        ptr("Initial evaluation proposal."),
		}, http.StatusCreated, &withdrawnEng,
	); err == nil {
		_ = s.orgPost(
			ctx, other2, consumer2Domain, "withdraw-engagement",
			marketplace.EngagementTarget{EngagementID: withdrawnEng.ID, Version: withdrawnEng.Version},
			http.StatusOK, nil,
		)
	}

	// 2e. Ended engagement (Consumer 3 proposes to checks, provider accepts, consumer ends)
	var endedEng marketplace.Engagement
	if err := s.orgPost(
		ctx, other3, consumer3Domain, "propose-engagement",
		marketplace.ProposeEngagementRequest{
			ProviderDomain: checksDomain,
			Capability:     marketplace.BackgroundCheck,
			Message:        ptr("Seasonal background checks."),
		}, http.StatusCreated, &endedEng,
	); err == nil {
		clientEng, waitErr := s.awaitClientEngagement(ctx, tenant, checksDomain, endedEng.ID)
		if waitErr == nil {
			var active marketplace.Engagement
			if err := s.orgPost(
				ctx, tenant, checksDomain, "accept-engagement",
				marketplace.EngagementTarget{EngagementID: clientEng.ID, Version: clientEng.Version},
				http.StatusOK, &active,
			); err == nil {
				_ = s.orgPost(
					ctx, other3, consumer3Domain, "end-engagement",
					marketplace.EndEngagementRequest{
						EngagementID: active.ID,
						Version:      active.Version,
						Note:         ptr("Completed seasonal check engagement."),
					}, http.StatusOK, nil,
				)
			}
		}
	}

	// 3. Assign providers to Consumer 1 Opening #3 and route work
	sourcingEng := activeEngagements[marketplace.Sourcing]
	interviewingEng := activeEngagements[marketplace.Interviewing]
	assessmentEng := activeEngagements[marketplace.Assessment]
	checkEng := activeEngagements[marketplace.BackgroundCheck]

	// 3a. Assign sourcing engagement whole to Opening #3
	_ = s.orgPost(
		ctx, other1, consumer1Domain, "assign-opening-provider",
		marketplace.AssignOpeningProviderRequest{
			OpeningNumber: 3,
			EngagementID:  sourcingEng.ID,
		}, http.StatusOK, nil,
	)

	// 3b. Read Opening #3 stages
	var openingPipeline openings.OpeningPipeline
	if err := s.orgPost(
		ctx, other1, consumer1Domain, "get-opening-pipeline",
		openings.GetOpeningPipelineRequest{OpeningNumber: 3}, http.StatusOK, &openingPipeline,
	); err != nil {
		return fmt.Errorf("get opening pipeline 3 on %s: %w", consumer1Domain, err)
	}

	var interviewStageID, assessmentStageID, checkStageID hiring.PipelineStageID
	for _, st := range openingPipeline.Stages {
		switch st.Kind {
		case hiring.InterviewStage:
			if interviewStageID == "" {
				interviewStageID = st.ID
			}
		case hiring.AssessmentStage:
			if assessmentStageID == "" {
				assessmentStageID = st.ID
			}
		case hiring.BackgroundCheckStage:
			if checkStageID == "" {
				checkStageID = st.ID
			}
		}
	}

	// Assign stage providers
	if interviewStageID != "" {
		_ = s.orgPost(
			ctx, other1, consumer1Domain, "assign-opening-provider",
			marketplace.AssignOpeningProviderRequest{
				OpeningNumber: 3,
				EngagementID:  interviewingEng.ID,
				StageID:       &interviewStageID,
			}, http.StatusOK, nil,
		)
	}
	if assessmentStageID != "" {
		_ = s.orgPost(
			ctx, other1, consumer1Domain, "assign-opening-provider",
			marketplace.AssignOpeningProviderRequest{
				OpeningNumber: 3,
				EngagementID:  assessmentEng.ID,
				StageID:       &assessmentStageID,
			}, http.StatusOK, nil,
		)
	}
	if checkStageID != "" {
		_ = s.orgPost(
			ctx, other1, consumer1Domain, "assign-opening-provider",
			marketplace.AssignOpeningProviderRequest{
				OpeningNumber: 3,
				EngagementID:  checkEng.ID,
				StageID:       &checkStageID,
			}, http.StatusOK, nil,
		)
	}

	// 3c. Route work items
	otherUsers, err := s.readProfileUsers(other1)
	if err != nil || len(otherUsers) < 3 {
		otherUsers, _ = s.readProfileUsers(other2)
	}

	// Candidate 1: Interview routing
	if len(otherUsers) > 0 && interviewStageID != "" {
		candEmail := otherUsers[len(otherUsers)-1]
		var ref hubapplications.ApplicationReference
		if err := s.hubPost(
			ctx, other1, candEmail, "apply-to-opening",
			hubapplications.ApplyToOpeningRequest{
				Domain:        consumer1Domain,
				OpeningNumber: 3,
				CoverNote:     ptr(orgapplications.ApplicationCoverNote("Applying for technical panel interview.")),
			}, http.StatusCreated, &ref,
		); err == nil {
			_ = s.orgPost(
				ctx, other1, consumer1Domain, "shortlist-application",
				orgapplications.ApplicationStageRequest{
					OpeningNumber:     3,
					ApplicationNumber: ref.ApplicationNumber,
					Version:           1,
					StageID:           interviewStageID,
				}, http.StatusOK, nil,
			)
			_ = s.orgPost(
				ctx, other1, consumer1Domain, "route-application",
				orgapplications.RouteApplicationRequest{
					OpeningNumber:     3,
					ApplicationNumber: ref.ApplicationNumber,
					Version:           2,
					EngagementID:      &interviewingEng.ID,
				}, http.StatusOK, nil,
			)

			// Provider schedules interview
			if item, err := s.awaitWorkItem(ctx, tenant, interviewsDomain, interviewingEng.ID); err == nil {
				adminEmail := common.EmailAddress("admin@" + string(interviewsDomain))
				_ = s.orgPost(
					ctx, tenant, interviewsDomain, "schedule-work-interview",
					work.ScheduleInterviewRequest{
						EngagementID: interviewingEng.ID,
						WorkID:       item.WorkID,
						InterviewDetails: orgapplications.InterviewDetails{
							StartTime:         time.Now().Add(48 * time.Hour).Truncate(time.Hour).UTC(),
							DurationMinutes:   45,
							Mode:              orgapplications.InterviewVideo,
							InterviewerEmails: []common.EmailAddress{adminEmail},
						},
					}, http.StatusOK, nil,
				)
			}
		}
	}

	// Candidate 2: Assessment routing
	if len(otherUsers) > 1 && assessmentStageID != "" {
		candEmail := otherUsers[len(otherUsers)-2]
		var ref hubapplications.ApplicationReference
		if err := s.hubPost(
			ctx, other1, candEmail, "apply-to-opening",
			hubapplications.ApplyToOpeningRequest{
				Domain:        consumer1Domain,
				OpeningNumber: 3,
				CoverNote:     ptr(orgapplications.ApplicationCoverNote("Applying for assessment.")),
			}, http.StatusCreated, &ref,
		); err == nil {
			_ = s.orgPost(
				ctx, other1, consumer1Domain, "shortlist-application",
				orgapplications.ApplicationStageRequest{
					OpeningNumber:     3,
					ApplicationNumber: ref.ApplicationNumber,
					Version:           1,
					StageID:           assessmentStageID,
				}, http.StatusOK, nil,
			)
			_ = s.orgPost(
				ctx, other1, consumer1Domain, "route-application",
				orgapplications.RouteApplicationRequest{
					OpeningNumber:     3,
					ApplicationNumber: ref.ApplicationNumber,
					Version:           2,
					EngagementID:      &assessmentEng.ID,
				}, http.StatusOK, nil,
			)

			// Provider records assessment score
			if item, err := s.awaitWorkItem(ctx, tenant, assessmentsDomain, assessmentEng.ID); err == nil {
				score := orgapplications.AssessmentScore(88)
				_ = s.orgPost(
					ctx, tenant, assessmentsDomain, "record-work-assessment",
					work.RecordAssessmentRequest{
						EngagementID: assessmentEng.ID,
						WorkID:       item.WorkID,
						Outcome:      orgapplications.AssessmentPass,
						Score:        &score,
					}, http.StatusOK, nil,
				)
			}
		}
	}

	// Candidate 3: Background check routing and consent
	if len(otherUsers) > 2 && checkStageID != "" {
		candEmail := otherUsers[len(otherUsers)-3]
		var ref hubapplications.ApplicationReference
		if err := s.hubPost(
			ctx, other1, candEmail, "apply-to-opening",
			hubapplications.ApplyToOpeningRequest{
				Domain:        consumer1Domain,
				OpeningNumber: 3,
				CoverNote:     ptr(orgapplications.ApplicationCoverNote("Applying for background check verification.")),
			}, http.StatusCreated, &ref,
		); err == nil {
			_ = s.orgPost(
				ctx, other1, consumer1Domain, "shortlist-application",
				orgapplications.ApplicationStageRequest{
					OpeningNumber:     3,
					ApplicationNumber: ref.ApplicationNumber,
					Version:           1,
					StageID:           checkStageID,
				}, http.StatusOK, nil,
			)
			_ = s.orgPost(
				ctx, other1, consumer1Domain, "route-application",
				orgapplications.RouteApplicationRequest{
					OpeningNumber:     3,
					ApplicationNumber: ref.ApplicationNumber,
					Version:           2,
					EngagementID:      &checkEng.ID,
				}, http.StatusOK, nil,
			)

			// Hub candidate provides consent
			var myApp hubapplications.MyApplicationDetail
			if err := s.hubPost(
				ctx, other1, candEmail, "get-my-application",
				hubapplications.ApplicationReference{
					Domain:            consumer1Domain,
					OpeningNumber:     3,
					ApplicationNumber: ref.ApplicationNumber,
				}, http.StatusOK, &myApp,
			); err == nil && myApp.BackgroundCheckConsent != nil {
				_ = s.hubPost(
					ctx, other1, candEmail, "give-application-background-check-consent",
					hubapplications.BackgroundCheckConsentRequest{
						Domain:            consumer1Domain,
						OpeningNumber:     3,
						ApplicationNumber: ref.ApplicationNumber,
						CheckNumber:       myApp.BackgroundCheckConsent.CheckNumber,
					}, http.StatusOK, nil,
				)

				// Provider records result
				if item, err := s.awaitWorkItem(ctx, tenant, checksDomain, checkEng.ID); err == nil {
					_ = s.orgPost(
						ctx, tenant, checksDomain, "record-work-background-check-result",
						work.RecordBackgroundCheckResultRequest{
							EngagementID: checkEng.ID,
							WorkID:       item.WorkID,
							CheckType:    hiring.IdentityCheck,
							Outcome:      orgapplications.CheckClear,
						}, http.StatusOK, nil,
					)
				}
			}
		}
	}

	// 4. Agency Contacts, Notes, and Conversations with Hub users in other regions
	hubUsersOther, err := s.readProfileUsers(other1)
	if err != nil || len(hubUsersOther) < 2 {
		hubUsersOther, _ = s.readProfileUsers(other2)
	}

	if len(hubUsersOther) >= 2 {
		// User 1: Conversation + Notes
		user1Email := hubUsersOther[0]
		sess1, err := s.hubLogin(ctx, other1, user1Email)
		if err == nil {
			var addedNote contacts.AddedNote
			_ = s.orgPost(
				ctx, tenant, agencyDomain, "add-person-note",
				contacts.AddPersonNoteRequest{
					Address: hubprofile.ProfileAddress(sess1.handle),
					Text:    contacts.NoteText("Exceptional track record in distributed backend systems."),
				}, http.StatusOK, &addedNote,
			)

			var conv contacts.ConversationDetail
			if err := s.orgPost(
				ctx, tenant, agencyDomain, "start-conversation",
				contacts.StartConversationRequest{
					Address: hubprofile.ProfileAddress(sess1.handle),
					Text:    ptr(contacts.MessageText("Hello! We represent engineering teams hiring senior roles.")),
				}, http.StatusOK, &conv,
			); err == nil {
				contactID := conv.Conversation.ContactID

				// Send Opening suggestion message
				_ = s.orgPost(
					ctx, tenant, agencyDomain, "send-message",
					contacts.SendMessageRequest{
						ContactID: contactID,
						Suggestion: &contacts.OpeningSuggestion{
							ConsumerDomain: consumer1Domain,
							OpeningNumber:  3,
						},
					}, http.StatusOK, nil,
				)

				// Wait for Hub user to see conversation, then Hub user replies
				if _, waitErr := s.awaitHubConversation(ctx, other1, user1Email, contactID); waitErr == nil {
					_ = s.hubPost(
						ctx, other1, user1Email, "reply-to-conversation",
						hubmessages.ReplyToConversationRequest{
							ContactID: contactID,
							Text:      contacts.MessageText("Hi! Thanks for reaching out. I would love to learn more about this role."),
						}, http.StatusOK, nil,
					)
				}

				// Agency adds follow-up note on Contact
				_ = s.orgPost(
					ctx, tenant, agencyDomain, "add-contact-note",
					contacts.AddContactNoteRequest{
						ContactID: contactID,
						Text:      contacts.NoteText("Candidate expressed interest in Opening #3; scheduling intro call."),
					}, http.StatusOK, nil,
				)
			}
		}

		// User 2: Notes-only Contact (no conversation started)
		user2Email := hubUsersOther[1]
		sess2, err := s.hubLogin(ctx, other1, user2Email)
		if err == nil {
			var addedNote2 contacts.AddedNote
			_ = s.orgPost(
				ctx, tenant, agencyDomain, "add-person-note",
				contacts.AddPersonNoteRequest{
					Address: hubprofile.ProfileAddress(sess2.handle),
					Text:    contacts.NoteText("Solid product leadership profile. Kept on file for staff/lead searches."),
				}, http.StatusOK, &addedNote2,
			)
		}
	}

	log.Printf("seeded marketplace tenant=%s providers=4 engagements=5 routed_work=3 contacts=2", tenant)
	return nil
}
