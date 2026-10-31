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
	"github.com/vetchium/src/typespec/orgs/authorization"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/orgs/openings"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/service"
)

var marketplaceSeedTenants = []string{"sgp", "usa1", "deu", "ind1"}

// marketplaceAwait bounds each wait for another tenant to apply a command or
// an outbox event.
const marketplaceAwait = 30 * time.Second

type marketplaceSeedSettings struct {
	orgsOrigins map[string]string
	hubOrigins  map[string]string
	mailpitURL  string
	profilesDir string
	tenantID    string
}

func loadMarketplaceSeedSettings() (marketplaceSeedSettings, error) {
	var s marketplaceSeedSettings
	s.tenantID = strings.TrimSpace(os.Getenv("DEV_SEED_TENANT"))
	if s.tenantID == "" {
		return s, fmt.Errorf("missing DEV_SEED_TENANT")
	}
	s.mailpitURL = strings.TrimRight(strings.TrimSpace(os.Getenv("DEV_SEED_MAILPIT_URL")), "/")
	if s.mailpitURL == "" {
		s.mailpitURL = "http://127.0.0.1:18025"
	}
	s.profilesDir = strings.TrimRight(strings.TrimSpace(os.Getenv("DEV_SEED_HUB_PROFILES_DIR")), "/")
	if s.profilesDir == "" {
		s.profilesDir = "dev/hub-seed-profiles"
	}
	origins := func(variable string) map[string]string {
		found := map[string]string{}
		for _, pair := range strings.Split(os.Getenv(variable), ",") {
			tenant, origin, ok := strings.Cut(strings.TrimSpace(pair), "=")
			if ok && tenant != "" && origin != "" {
				found[tenant] = strings.TrimRight(origin, "/")
			}
		}
		for _, tenant := range marketplaceSeedTenants {
			if found[tenant] == "" {
				found[tenant] = fmt.Sprintf("http://%s.api.vetchium.localhost", tenant)
			}
		}
		return found
	}
	s.orgsOrigins = origins("DEV_SEED_ORGS_ORIGINS")
	s.hubOrigins = origins("DEV_SEED_HUB_ORIGINS")
	return s, nil
}

// providerSpec is one provider Org each tenant gets: its domain kind and
// number (age1 is the first agency), its one Listing, and the users who do
// its work, each holding org:fulfil_engagements.
type providerSpec struct {
	kind       string
	number     int
	name       string
	capability marketplace.Capability
	headline   string
	desc       string
	price      string
	checkTypes []hiring.CheckType
	disclosure *string
	workers    []string
}

func (p providerSpec) domain(tenant string) orgs.OrgDomain {
	return seededOrgDomain(p.kind, p.number, tenant)
}

var (
	agency1 = providerSpec{
		kind: "age", number: 1, name: "Staffing Agency 1",
		capability: marketplace.Sourcing,
		headline:   "Technology and operations hiring",
		desc:       "A large staffing agency: each agent looks after a dozen Openings across many clients.",
		price:      "Success fee per joined candidate",
		workers:    []string{"agent1", "agent2", "agent3", "agent4"},
	}
	agency2 = providerSpec{
		kind: "age", number: 2, name: "Staffing Agency 2",
		capability: marketplace.Sourcing,
		headline:   "Regional specialist recruiting",
		desc:       "A small regional agency working with the hiring companies of its own region.",
		price:      "Retainer or success fee",
		workers:    []string{"agent1", "agent2"},
	}
	interviewProvider = providerSpec{
		kind: "itv", number: 1, name: "Interviewing Services 1",
		capability: marketplace.Interviewing,
		headline:   "Standardized technical interviews",
		desc:       "Live technical interviews and coding panels conducted by senior engineers.",
		price:      "Quoted per interview session",
		workers:    []string{"staff1", "staff2"},
	}
	assessmentProvider = providerSpec{
		kind: "asm", number: 1, name: "Assessment Services 1",
		capability: marketplace.Assessment,
		headline:   "Real-world coding assessments",
		desc:       "Standardized take-home evaluations and automated coding assessments.",
		price:      "Per candidate test",
		workers:    []string{"staff1", "staff2"},
	}
	checkProvider = providerSpec{
		kind: "bgv", number: 1, name: "Background Verification 1",
		capability: marketplace.BackgroundCheck,
		headline:   "Identity, education, and employment checks",
		desc:       "Identity, education, and employment credential verification.",
		price:      "Tiered check packages",
		checkTypes: []hiring.CheckType{
			hiring.IdentityCheck, hiring.EducationCheck, hiring.EmploymentCheck,
		},
		disclosure: ptr("We verify identity, education, and previous employment credentials."),
		workers:    []string{"staff1", "staff2"},
	}
	providerSpecs = []providerSpec{
		agency1, agency2, interviewProvider, assessmentProvider, checkProvider,
	}
)

// sourcedOpenings are the Openings every hiring company assigns to the
// agencies it engages: the ones the Org seeder leaves published (3, 7, 8, 10)
// or paused (4, 9).
var sourcedOpenings = []openings.OpeningNumber{3, 4, 7, 8, 9, 10}

// suggestedOpening is the published Opening agencies suggest to Contacts
// ("Technical writer", with a close pending); no other seed applies to it.
const suggestedOpening = openings.OpeningNumber(10)

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
			settings: orgSeedSettings{mailpitOrigin: settings.mailpitURL},
			client:   &http.Client{Timeout: 30 * time.Second},
		},
		settings:    settings,
		orgTokens:   map[string]string{},
		hubSessions: map[string]marketplaceHubUserSession{},
	}
	if err := seeder.seedTenant(ctx, settings.tenantID); err != nil {
		return fmt.Errorf("seed marketplace for tenant %s: %w", settings.tenantID, err)
	}
	return nil
}

func tenantOf(domain orgs.OrgDomain) string {
	labels := strings.Split(string(domain), ".")
	return labels[len(labels)-2]
}

// orgPostAs sends an Orgs API write as local@domain in the domain's tenant.
func (s *marketplaceSeeder) orgPostAs(
	ctx context.Context, domain orgs.OrgDomain, local, path string, body any, want int, out any,
) error {
	key := local + "@" + string(domain)
	origin := s.settings.orgsOrigins[tenantOf(domain)]
	bearer, ok := s.orgTokens[key]
	if !ok {
		var session orgsauth.LoginAuthenticatedResponse
		if err := s.postAt(ctx, origin, "/api/orgs/login", orgsauth.LoginRequest{
			Domain:       domain,
			EmailAddress: common.EmailAddress(key),
			Password:     common.Password(devSeedHubUserPassword),
		}, "", http.StatusOK, &session); err != nil {
			return fmt.Errorf("sign in %s: %w", key, err)
		}
		bearer = string(session.SessionToken)
		s.orgTokens[key] = bearer
	}
	// A loaded development stack sometimes answers 5xx before writing
	// anything; one Idempotency-Key across attempts keeps retries safe.
	idempotencyKey := newIdempotencyKey()
	for attempt := 1; ; attempt++ {
		err := s.postAtWithKey(ctx, origin, "/api/orgs/"+path, body, bearer,
			idempotencyKey, want, out)
		var status *statusError
		if err == nil || attempt == 3 || !errors.As(err, &status) || status.status < 500 {
			if err != nil {
				return fmt.Errorf("%s as %s: %w", path, key, err)
			}
			return nil
		}
		log.Printf("retrying %s as %s after: %v", path, key, err)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt) * time.Second):
		}
	}
}

func (s *marketplaceSeeder) orgPost(
	ctx context.Context, domain orgs.OrgDomain, path string, body any, want int, out any,
) error {
	return s.orgPostAs(ctx, domain, "admin", path, body, want, out)
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
		origin: origin, token: string(resp.SessionToken), handle: string(resp.Handle),
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
	if err := s.postAt(ctx, sess.origin, "/api/hub/"+path, body, sess.token, want, out); err != nil {
		return fmt.Errorf("%s as %s: %w", path, email, err)
	}
	return nil
}

// await retries check until it reports done or marketplaceAwait passes, for
// state another tenant applies through the mesh.
func await(ctx context.Context, what string, check func() (bool, error)) error {
	deadline := time.Now().Add(marketplaceAwait)
	for {
		done, err := check()
		if done {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for %s (last error: %v)", what, err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}

// ensureProvider signs the provider up in tenant on the Silver plan (which
// allows Listings), invites its workers, and lists its one Capability.
func (s *marketplaceSeeder) ensureProvider(
	ctx context.Context, tenant string, spec providerSpec,
) error {
	domain := spec.domain(tenant)
	origin := s.settings.orgsOrigins[tenant]
	country, ok := seededOrgCountries[tenant]
	if !ok {
		return fmt.Errorf("no seeded Org country for tenant %q", tenant)
	}
	bearer, err := s.signupOrg(ctx, origin, domain,
		fmt.Sprintf("%s %s", strings.ToUpper(tenant), spec.name), country,
		subscriptionspec.SilverTier)
	if err != nil {
		return fmt.Errorf("sign up %s: %w", domain, err)
	}
	s.orgTokens["admin@"+string(domain)] = bearer
	workers := make([]seededUser, 0, len(spec.workers))
	for _, local := range spec.workers {
		workers = append(workers, seededUser{local: local, permissions: []authorization.OrgPermissionID{
			authorization.OrgPermissionID(authorization.FulfilEngagements),
		}})
	}
	if err := s.inviteUsers(ctx, origin, bearer, domain, workers); err != nil {
		return err
	}
	var created marketplace.Listing
	if err := s.orgPost(ctx, domain, "create-listing", marketplace.CreateListingRequest{
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
	}, http.StatusCreated, &created); err != nil {
		return err
	}
	return s.orgPost(ctx, domain, "publish-listing", marketplace.ListingTarget{
		Capability: spec.capability, Version: created.Version,
	}, http.StatusOK, nil)
}

// propose sends the client's proposal and waits until the provider's tenant
// has projected it, returning the engagement as the provider reads it.
func (s *marketplaceSeeder) propose(
	ctx context.Context, client, provider orgs.OrgDomain, capability marketplace.Capability,
	message string,
) (marketplace.Engagement, error) {
	var proposed marketplace.Engagement
	if err := s.orgPost(ctx, client, "propose-engagement", marketplace.ProposeEngagementRequest{
		ProviderDomain: provider, Capability: capability, Message: &message,
	}, http.StatusCreated, &proposed); err != nil {
		return marketplace.Engagement{}, err
	}
	return s.awaitProviderEngagement(ctx, provider, proposed.ID, marketplace.ProposedEngagement)
}

// awaitProviderEngagement waits until the provider's projection of an
// engagement reaches state.
func (s *marketplaceSeeder) awaitProviderEngagement(
	ctx context.Context, provider orgs.OrgDomain, id marketplace.EngagementID,
	state marketplace.EngagementState,
) (marketplace.Engagement, error) {
	var engagement marketplace.Engagement
	err := await(ctx, fmt.Sprintf("engagement %s %s at %s", id, state, provider), func() (bool, error) {
		err := s.orgPost(ctx, provider, "get-client-engagement",
			marketplace.GetEngagementRequest{EngagementID: id}, http.StatusOK, &engagement)
		return err == nil && engagement.State == state, err
	})
	return engagement, err
}

// engage proposes an engagement and has the provider accept it, waiting
// until both tenants hold it as active.
func (s *marketplaceSeeder) engage(
	ctx context.Context, client, provider orgs.OrgDomain, capability marketplace.Capability,
) (marketplace.Engagement, error) {
	proposed, err := s.propose(ctx, client, provider, capability,
		fmt.Sprintf("%s would like %s for its Openings.", client, capability))
	if err != nil {
		return marketplace.Engagement{}, err
	}
	if err := s.orgPost(ctx, provider, "accept-engagement", marketplace.EngagementTarget{
		EngagementID: proposed.ID, Version: proposed.Version,
	}, http.StatusOK, nil); err != nil {
		return marketplace.Engagement{}, err
	}
	return s.awaitProviderEngagement(ctx, provider, proposed.ID, marketplace.ActiveEngagement)
}

func (s *marketplaceSeeder) assign(
	ctx context.Context, client orgs.OrgDomain, engagement marketplace.EngagementID,
	opening openings.OpeningNumber, stage *hiring.PipelineStageID,
) error {
	return s.orgPost(ctx, client, "assign-opening-provider", marketplace.AssignOpeningProviderRequest{
		OpeningNumber: opening, EngagementID: engagement, StageID: stage,
	}, http.StatusOK, nil)
}

type seededJob struct {
	engagement marketplace.EngagementID
	opening    openings.OpeningNumber
}

// engageAgency makes each client an active client of the agency and assigns
// it the given Openings, returning the Jobs the agency now has.
func (s *marketplaceSeeder) engageAgency(
	ctx context.Context, agency orgs.OrgDomain, clients []orgs.OrgDomain,
	assigned []openings.OpeningNumber,
) ([]seededJob, error) {
	var jobs []seededJob
	for _, client := range clients {
		engagement, err := s.engage(ctx, client, agency, marketplace.Sourcing)
		if err != nil {
			return nil, err
		}
		for _, opening := range assigned {
			if err := s.assign(ctx, client, engagement.ID, opening, nil); err != nil {
				return nil, err
			}
			jobs = append(jobs, seededJob{engagement: engagement.ID, opening: opening})
		}
	}
	return jobs, nil
}

// spreadOwners gives the agency's Jobs to its agents in turn, as the agency's
// admin would, leaving every fifth Job without an owner so the "No owner"
// state has data.
func (s *marketplaceSeeder) spreadOwners(
	ctx context.Context, agency orgs.OrgDomain, agents []string, jobs []seededJob,
) (int, error) {
	owned := 0
	for index, job := range jobs {
		if index%5 == 4 {
			continue
		}
		owner := common.EmailAddress(agents[owned%len(agents)] + "@" + string(agency))
		if err := s.orgPost(ctx, agency, "set-job-owner", work.SetJobOwnerRequest{
			EngagementID: job.engagement, OpeningNumber: job.opening,
			OwnerVersion: 0, OwnerEmail: &owner,
		}, http.StatusOK, nil); err != nil {
			return owned, err
		}
		owned++
	}
	return owned, nil
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

// seedTenant gives the tenant its agencies and service providers and their
// clients across every tenant. Every hiring company, here and elsewhere,
// already exists (dev-seed-orgs runs for every tenant first).
func (s *marketplaceSeeder) seedTenant(ctx context.Context, tenant string) error {
	var home int
	for i, t := range marketplaceSeedTenants {
		if t == tenant {
			home = i
		}
	}
	other := func(offset int) string {
		return marketplaceSeedTenants[(home+offset)%len(marketplaceSeedTenants)]
	}
	company := func(number int, in string) orgs.OrgDomain {
		return seededOrgDomain(hiringCompanyKind, number, in)
	}

	for _, spec := range providerSpecs {
		if err := s.ensureProvider(ctx, tenant, spec); err != nil {
			return fmt.Errorf("provider %s: %w", spec.domain(tenant), err)
		}
	}

	// The large agency works for every hiring company in every tenant.
	age1 := agency1.domain(tenant)
	var everyCompany []orgs.OrgDomain
	for _, in := range marketplaceSeedTenants {
		for _, org := range seededOrgs {
			everyCompany = append(everyCompany, company(org.number, in))
		}
	}
	jobs1, err := s.engageAgency(ctx, age1, everyCompany, sourcedOpenings)
	if err != nil {
		return fmt.Errorf("agency %s: %w", age1, err)
	}
	owned1, err := s.spreadOwners(ctx, age1, agency1.workers, jobs1)
	if err != nil {
		return fmt.Errorf("owners at %s: %w", age1, err)
	}

	// The small agency works for its own region's companies, has a proposal
	// waiting, and an engagement its client ended.
	age2 := agency2.domain(tenant)
	jobs2, err := s.engageAgency(ctx, age2,
		[]orgs.OrgDomain{company(1, tenant), company(2, tenant), company(3, tenant)},
		[]openings.OpeningNumber{3, 7})
	if err != nil {
		return fmt.Errorf("agency %s: %w", age2, err)
	}
	owned2, err := s.spreadOwners(ctx, age2, agency2.workers, jobs2)
	if err != nil {
		return fmt.Errorf("owners at %s: %w", age2, err)
	}
	if _, err := s.propose(ctx, company(1, other(1)), age2, marketplace.Sourcing,
		"We are hiring in your region; could you help?"); err != nil {
		return fmt.Errorf("proposal to %s: %w", age2, err)
	}
	if err := s.endEngagement(ctx, company(2, other(1)), age2, marketplace.Sourcing); err != nil {
		return fmt.Errorf("ended engagement with %s: %w", age2, err)
	}

	routed, err := s.seedStageProviders(ctx, tenant, company(3, other(1)))
	if err != nil {
		return err
	}
	if err := s.seedDeclinedAndWithdrawn(ctx, tenant, other); err != nil {
		return err
	}
	contactsSeeded, err := s.seedAgencyContacts(ctx, tenant, other(1))
	if err != nil {
		return err
	}
	log.Printf("seeded marketplace tenant=%s agencies=%s(%d jobs, %d owned),%s(%d jobs, %d owned) routed_work=%d contacts=%d",
		tenant, age1, len(jobs1), owned1, age2, len(jobs2), owned2, routed, contactsSeeded)
	return nil
}

// endEngagement makes an engagement active and has its client end it.
func (s *marketplaceSeeder) endEngagement(
	ctx context.Context, client, provider orgs.OrgDomain, capability marketplace.Capability,
) error {
	engagement, err := s.engage(ctx, client, provider, capability)
	if err != nil {
		return err
	}
	var current marketplace.Engagement
	if err := s.orgPost(ctx, client, "get-engagement",
		marketplace.GetEngagementRequest{EngagementID: engagement.ID}, http.StatusOK, &current); err != nil {
		return err
	}
	return s.orgPost(ctx, client, "end-engagement", marketplace.EndEngagementRequest{
		EngagementID: current.ID, Version: current.Version,
		Note: ptr("The season's hiring is complete."),
	}, http.StatusOK, nil)
}

// seedDeclinedAndWithdrawn leaves a declined and a withdrawn proposal with
// the tenant's service providers.
func (s *marketplaceSeeder) seedDeclinedAndWithdrawn(
	ctx context.Context, tenant string, other func(int) string,
) error {
	interviews := interviewProvider.domain(tenant)
	declined, err := s.propose(ctx, seededOrgDomain(hiringCompanyKind, 2, other(3)), interviews,
		marketplace.Interviewing, "Requesting interviewers for next quarter.")
	if err != nil {
		return fmt.Errorf("proposal to %s: %w", interviews, err)
	}
	if err := s.orgPost(ctx, interviews, "decline-engagement", marketplace.EngagementTarget{
		EngagementID: declined.ID, Version: declined.Version,
	}, http.StatusOK, nil); err != nil {
		return err
	}
	assessments := assessmentProvider.domain(tenant)
	client := seededOrgDomain(hiringCompanyKind, 2, other(2))
	var withdrawn marketplace.Engagement
	if err := s.orgPost(ctx, client, "propose-engagement", marketplace.ProposeEngagementRequest{
		ProviderDomain: assessments, Capability: marketplace.Assessment,
		Message: ptr("An initial evaluation proposal."),
	}, http.StatusCreated, &withdrawn); err != nil {
		return err
	}
	if err := s.orgPost(ctx, client, "withdraw-engagement", marketplace.EngagementTarget{
		EngagementID: withdrawn.ID, Version: withdrawn.Version,
	}, http.StatusOK, nil); err != nil {
		return err
	}
	return s.endEngagement(ctx, seededOrgDomain(hiringCompanyKind, 3, other(3)),
		checkProvider.domain(tenant), marketplace.BackgroundCheck)
}

// stageCandidacy has an applicant apply to the client's Opening, shortlists
// the application to the stage, and routes it to the engagement.
func (s *marketplaceSeeder) stageCandidacy(
	ctx context.Context, client orgs.OrgDomain, opening openings.OpeningNumber,
	applicantTenant, applicant string, stage hiring.PipelineStageID,
	engagement marketplace.EngagementID,
) (orgapplications.ApplicationNumber, error) {
	var live openings.OrgOpening
	if err := s.orgPost(ctx, client, "get-opening", openings.GetOpeningRequest{OpeningNumber: opening},
		http.StatusOK, &live); err != nil {
		return 0, err
	}
	var questions []common.ApplicationQuestion
	if live.LiveContent != nil {
		questions = live.LiveContent.Questions
	}
	var ref hubapplications.ApplicationReference
	if err := s.hubPost(ctx, applicantTenant, applicant, "apply-to-opening",
		hubapplications.ApplyToOpeningRequest{
			Domain: client, OpeningNumber: opening,
			CoverNote: ptr(orgapplications.ApplicationCoverNote("I would like to be considered for this role.")),
			// Every applicant here answers alike; index 0 answers the optional
			// questions too.
			Answers: seedAnswers(questions, 0),
		}, http.StatusCreated, &ref); err != nil {
		return 0, err
	}
	version := func() (orgapplications.ApplicationVersion, error) {
		var detail orgapplications.ApplicationDetail
		err := s.orgPost(ctx, client, "get-application", orgapplications.GetApplicationRequest{
			OpeningNumber: opening, ApplicationNumber: ref.ApplicationNumber,
		}, http.StatusOK, &detail)
		return detail.Version, err
	}
	current, err := version()
	if err != nil {
		return 0, err
	}
	if err := s.orgPost(ctx, client, "shortlist-application", orgapplications.ApplicationStageRequest{
		OpeningNumber: opening, ApplicationNumber: ref.ApplicationNumber,
		Version: current, StageID: stage,
	}, http.StatusOK, nil); err != nil {
		return 0, err
	}
	if current, err = version(); err != nil {
		return 0, err
	}
	if err := s.orgPost(ctx, client, "route-application", orgapplications.RouteApplicationRequest{
		OpeningNumber: opening, ApplicationNumber: ref.ApplicationNumber,
		Version: current, EngagementID: &engagement,
	}, http.StatusOK, nil); err != nil {
		return 0, err
	}
	return ref.ApplicationNumber, nil
}

// awaitWorkItem waits for a work item of the engagement other than skip.
func (s *marketplaceSeeder) awaitWorkItem(
	ctx context.Context, provider orgs.OrgDomain, engagement marketplace.EngagementID, skip work.WorkID,
) (work.WorkItem, error) {
	var found work.WorkItem
	err := await(ctx, fmt.Sprintf("work of %s at %s", engagement, provider), func() (bool, error) {
		var resp work.ListWorkQueueResponse
		err := s.orgPost(ctx, provider, "list-work-queue", work.ListWorkQueueRequest{},
			http.StatusOK, &resp)
		for _, item := range resp.Items {
			if item.EngagementID == engagement && item.WorkID != skip {
				found = item
				return true, nil
			}
		}
		return false, err
	})
	return found, err
}

// seedStageProviders makes the tenant's interviewing, assessment, and
// background-check providers active for one client, assigns them to the
// stages of its engineering Opening, and routes one candidacy to each, which
// the provider then works. The applicants are this tenant's Hub users, who
// have not applied to that client's Openings (dev-seed-applications applies
// the client region's and the next region's users).
func (s *marketplaceSeeder) seedStageProviders(
	ctx context.Context, tenant string, client orgs.OrgDomain,
) (int, error) {
	var pipeline openings.OpeningPipeline
	if err := s.orgPost(ctx, client, "get-opening-pipeline",
		openings.GetOpeningPipelineRequest{OpeningNumber: engineeringOpening},
		http.StatusOK, &pipeline); err != nil {
		return 0, err
	}
	stageOf := map[hiring.StageKind]hiring.PipelineStageID{}
	for _, stage := range pipeline.Stages {
		if _, seen := stageOf[stage.Kind]; !seen {
			stageOf[stage.Kind] = stage.ID
		}
	}
	applicants, err := s.readProfileUsers(tenant)
	if err != nil {
		return 0, err
	}
	if len(applicants) < 4 {
		return 0, fmt.Errorf("tenant %s has fewer than four Hub users", tenant)
	}
	steps := []struct {
		spec  providerSpec
		stage hiring.StageKind
		work  func(provider orgs.OrgDomain, engagement marketplace.EngagementID,
			item work.WorkItem, applicant string, number orgapplications.ApplicationNumber) error
	}{
		{interviewProvider, hiring.InterviewStage, func(
			provider orgs.OrgDomain, engagement marketplace.EngagementID, item work.WorkItem,
			_ string, _ orgapplications.ApplicationNumber,
		) error {
			video := hubprofile.WebsiteURL("https://meet.example.com/provider-interview")
			return s.orgPostAs(ctx, provider, "staff1", "schedule-work-interview",
				work.ScheduleInterviewRequest{
					EngagementID: engagement, WorkID: item.WorkID,
					InterviewDetails: orgapplications.InterviewDetails{
						StartTime:       time.Now().Add(48 * time.Hour).Truncate(time.Hour).UTC(),
						DurationMinutes: 45,
						Mode:            orgapplications.InterviewVideo,
						VideoURL:        &video,
						InterviewerEmails: []common.EmailAddress{
							common.EmailAddress("staff1@" + string(provider)),
						},
					},
				}, http.StatusOK, nil)
		}},
		{assessmentProvider, hiring.AssessmentStage, func(
			provider orgs.OrgDomain, engagement marketplace.EngagementID, item work.WorkItem,
			_ string, _ orgapplications.ApplicationNumber,
		) error {
			score := orgapplications.AssessmentScore(88)
			return s.orgPostAs(ctx, provider, "staff1", "record-work-assessment",
				work.RecordAssessmentRequest{
					EngagementID: engagement, WorkID: item.WorkID,
					Outcome: orgapplications.AssessmentPass, Score: &score,
				}, http.StatusOK, nil)
		}},
		{checkProvider, hiring.BackgroundCheckStage, func(
			provider orgs.OrgDomain, engagement marketplace.EngagementID, item work.WorkItem,
			applicant string, number orgapplications.ApplicationNumber,
		) error {
			var detail orgapplications.ApplicationDetail
			if err := s.orgPost(ctx, client, "get-application", orgapplications.GetApplicationRequest{
				OpeningNumber: engineeringOpening, ApplicationNumber: number,
			}, http.StatusOK, &detail); err != nil {
				return err
			}
			if err := s.orgPost(ctx, client, "request-background-check-consent",
				orgapplications.RequestBackgroundCheckConsentRequest{
					OpeningNumber: engineeringOpening, ApplicationNumber: number,
					Version:    detail.Version,
					CheckTypes: []hiring.CheckType{hiring.IdentityCheck, hiring.EmploymentCheck},
				}, http.StatusOK, nil); err != nil {
				return err
			}
			reference := hubapplications.ApplicationReference{
				Domain: client, OpeningNumber: engineeringOpening, ApplicationNumber: number,
			}
			var mine hubapplications.MyApplicationDetail
			if err := s.hubPost(ctx, tenant, applicant, "get-my-application", reference,
				http.StatusOK, &mine); err != nil {
				return err
			}
			if mine.BackgroundCheckConsent == nil {
				return fmt.Errorf("application %d has no consent request", number)
			}
			if err := s.hubPost(ctx, tenant, applicant, "give-application-background-check-consent",
				hubapplications.BackgroundCheckConsentRequest{
					Domain: client, OpeningNumber: engineeringOpening, ApplicationNumber: number,
					CheckNumber: mine.BackgroundCheckConsent.CheckNumber,
				}, http.StatusOK, nil); err != nil {
				return err
			}
			return s.orgPostAs(ctx, provider, "staff1", "record-work-background-check-result",
				work.RecordBackgroundCheckResultRequest{
					EngagementID: engagement, WorkID: item.WorkID,
					CheckType: hiring.IdentityCheck, Outcome: orgapplications.CheckClear,
				}, http.StatusOK, nil)
		}},
	}
	var interviewing marketplace.EngagementID
	var upcoming work.WorkID
	for index, step := range steps {
		provider := step.spec.domain(tenant)
		stage, ok := stageOf[step.stage]
		if !ok {
			return index, fmt.Errorf("opening %d of %s has no %s stage", engineeringOpening, client, step.stage)
		}
		engagement, err := s.engage(ctx, client, provider, step.spec.capability)
		if err != nil {
			return index, fmt.Errorf("engage %s: %w", provider, err)
		}
		if err := s.assign(ctx, client, engagement.ID, engineeringOpening, &stage); err != nil {
			return index, err
		}
		applicant := applicants[len(applicants)-1-index]
		number, err := s.stageCandidacy(ctx, client, engineeringOpening, tenant, applicant,
			stage, engagement.ID)
		if err != nil {
			return index, fmt.Errorf("route to %s: %w", provider, err)
		}
		item, err := s.awaitWorkItem(ctx, provider, engagement.ID, "")
		if err != nil {
			return index, err
		}
		if err := step.work(provider, engagement.ID, item, applicant, number); err != nil {
			return index, fmt.Errorf("work at %s: %w", provider, err)
		}
		if step.stage == hiring.InterviewStage {
			interviewing, upcoming = engagement.ID, item.WorkID
		}
	}
	if err := s.seedProviderFeedback(ctx, tenant, client, applicants[len(applicants)-1-len(steps)],
		stageOf[hiring.InterviewStage], interviewing, upcoming); err != nil {
		return len(steps), fmt.Errorf("feedback at %s: %w", interviewProvider.domain(tenant), err)
	}
	return len(steps) + 1, nil
}

// seedProviderFeedback routes another candidacy to the interviewing provider,
// whose staff completes the interview and submits feedback on the stage's
// form; skip is the provider's other, upcoming interview.
func (s *marketplaceSeeder) seedProviderFeedback(
	ctx context.Context, tenant string, client orgs.OrgDomain, applicant string,
	stage hiring.PipelineStageID, engagement marketplace.EngagementID, skip work.WorkID,
) error {
	provider := interviewProvider.domain(tenant)
	if _, err := s.stageCandidacy(ctx, client, engineeringOpening, tenant, applicant, stage, engagement); err != nil {
		return err
	}
	item, err := s.awaitWorkItem(ctx, provider, engagement, skip)
	if err != nil {
		return err
	}
	reference := work.WorkReference{EngagementID: engagement, WorkID: item.WorkID}
	start := soonStart()
	video := hubprofile.WebsiteURL("https://meet.example.com/provider-panel")
	if err := s.orgPostAs(ctx, provider, "staff1", "schedule-work-interview", work.ScheduleInterviewRequest{
		EngagementID: engagement, WorkID: item.WorkID,
		InterviewDetails: orgapplications.InterviewDetails{
			StartTime: start, DurationMinutes: 45,
			Mode: orgapplications.InterviewVideo, VideoURL: &video,
			InterviewerEmails: []common.EmailAddress{common.EmailAddress("staff1@" + string(provider))},
		},
	}, http.StatusOK, nil); err != nil {
		return err
	}
	if err := sleepUntil(ctx, start); err != nil {
		return err
	}
	if err := s.orgPostAs(ctx, provider, "staff1", "record-work-interview-outcome", work.RecordInterviewOutcomeRequest{
		EngagementID: engagement, WorkID: item.WorkID,
		InterviewNumber: 1, Outcome: orgapplications.OutcomeCompleted,
	}, http.StatusOK, nil); err != nil {
		return err
	}
	var detail work.WorkDetail
	if err := s.orgPostAs(ctx, provider, "staff1", "get-work-item", reference, http.StatusOK, &detail); err != nil {
		return err
	}
	if len(detail.Interviews) == 0 {
		return fmt.Errorf("work %s has no interview", item.WorkID)
	}
	return s.orgPostAs(ctx, provider, "staff1", "submit-work-interview-feedback", work.SubmitInterviewFeedbackRequest{
		EngagementID: engagement, WorkID: item.WorkID, InterviewNumber: 1,
		Recommendation:  orgapplications.Yes,
		Notes:           orgapplications.InterviewFeedbackNotes("Strong fundamentals; clear trade-off reasoning under time pressure."),
		CriteriaAnswers: seedCriteriaAnswers(detail.Interviews[0].Stage.FeedbackForm, 4),
	}, http.StatusOK, nil)
}

// seedAgencyContacts gives the large agency Contacts among the next region's
// Hub users, each written by a different agent: a conversation with an
// Opening suggestion the person applied from (a `suggested` credit), a
// conversation whose person applied naming the agency (`declared`), and a
// Contact with notes only.
func (s *marketplaceSeeder) seedAgencyContacts(
	ctx context.Context, tenant, hubTenant string,
) (int, error) {
	agency := agency1.domain(tenant)
	people, err := s.readProfileUsers(hubTenant)
	if err != nil {
		return 0, err
	}
	if len(people) < 3 {
		return 0, fmt.Errorf("tenant %s has fewer than three Hub users", hubTenant)
	}
	handle := func(email string) (hubprofile.ProfileAddress, error) {
		session, err := s.hubLogin(ctx, hubTenant, email)
		return hubprofile.ProfileAddress(session.handle), err
	}
	converse := func(agent, email, note, text string) (contacts.ContactID, error) {
		address, err := handle(email)
		if err != nil {
			return "", err
		}
		if err := s.orgPostAs(ctx, agency, agent, "add-person-note", contacts.AddPersonNoteRequest{
			Address: address, Text: contacts.NoteText(note),
		}, http.StatusOK, nil); err != nil {
			return "", err
		}
		var conversation contacts.ConversationDetail
		if err := s.orgPostAs(ctx, agency, agent, "start-conversation", contacts.StartConversationRequest{
			Address: address, Text: ptr(contacts.MessageText(text)),
		}, http.StatusOK, &conversation); err != nil {
			return "", err
		}
		return conversation.Conversation.ContactID, nil
	}
	apply := func(email string, client orgs.OrgDomain) error {
		return s.hubPost(ctx, hubTenant, email, "apply-to-opening", hubapplications.ApplyToOpeningRequest{
			Domain: client, OpeningNumber: suggestedOpening, ReferralAgencyDomain: &agency,
		}, http.StatusCreated, nil)
	}

	suggestedTo := people[0]
	suggestedClient := seededOrgDomain(hiringCompanyKind, 1, tenant)
	contactID, err := converse("agent1", suggestedTo,
		"Strong distributed-systems background; open to a move this year.",
		"Hello! We place engineers with teams across several regions.")
	if err != nil {
		return 0, err
	}
	if err := s.orgPostAs(ctx, agency, "agent1", "send-message", contacts.SendMessageRequest{
		ContactID: contactID,
		Suggestion: &contacts.OpeningSuggestion{
			ConsumerDomain: suggestedClient, OpeningNumber: suggestedOpening,
		},
	}, http.StatusOK, nil); err != nil {
		return 0, err
	}
	if err := await(ctx, "the Hub conversation of "+suggestedTo, func() (bool, error) {
		var detail hubmessages.HubConversationDetail
		err := s.hubPost(ctx, hubTenant, suggestedTo, "get-conversation",
			hubmessages.GetConversationRequest{ContactID: contactID}, http.StatusOK, &detail)
		return err == nil && detail.Conversation.HasConversation, err
	}); err != nil {
		return 0, err
	}
	if err := s.hubPost(ctx, hubTenant, suggestedTo, "reply-to-conversation",
		hubmessages.ReplyToConversationRequest{
			ContactID: contactID,
			Text:      contacts.MessageText("Thanks, this role looks interesting. I will apply."),
		}, http.StatusOK, nil); err != nil {
		return 0, err
	}
	if err := apply(suggestedTo, suggestedClient); err != nil {
		return 0, err
	}

	declaredBy := people[1]
	if _, err := converse("agent2", declaredBy,
		"Product leader; prefers hybrid roles.",
		"Hi! We work with several product teams that are hiring."); err != nil {
		return 1, err
	}
	if err := apply(declaredBy, seededOrgDomain(hiringCompanyKind, 2, tenant)); err != nil {
		return 1, err
	}

	notesOnly, err := handle(people[2])
	if err != nil {
		return 2, err
	}
	if err := s.orgPostAs(ctx, agency, "agent3", "add-person-note", contacts.AddPersonNoteRequest{
		Address: notesOnly,
		Text:    contacts.NoteText("Kept on file for senior data roles; not contacted yet."),
	}, http.StatusOK, nil); err != nil {
		return 2, err
	}
	return 3, nil
}
