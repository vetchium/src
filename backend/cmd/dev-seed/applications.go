package main

import (
	"bytes"
	"context"
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
	hubprofile "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
	orgapplications "github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/service"
)

// applicationSeedTenants lists every region whose Hub users may apply, in the
// order Orgs of the next region take their remote applicants from.
var applicationSeedTenants = []string{"sgp", "usa1", "deu", "ind1"}

// Opening numbers the Org seeder gives its published roles: "product
// designer" (the first published) and "researcher" (a pending revision keeps
// it published).
const (
	engineeringOpening = 3
	quickHireOpening   = 7
)

type applicationSeedSettings struct {
	orgsOrigin, tenantID, profilesDir string
	hubOrigins                        map[string]string
}

func loadApplicationSeedSettings() (applicationSeedSettings, error) {
	var s applicationSeedSettings
	for name, target := range map[string]*string{
		"DEV_SEED_ORGS_ORIGIN":      &s.orgsOrigin,
		"DEV_SEED_TENANT":           &s.tenantID,
		"DEV_SEED_HUB_PROFILES_DIR": &s.profilesDir,
	} {
		value := strings.TrimSpace(os.Getenv(name))
		if value == "" {
			return applicationSeedSettings{}, fmt.Errorf("missing %s", name)
		}
		*target = strings.TrimRight(value, "/")
	}
	s.hubOrigins = map[string]string{}
	for _, pair := range strings.Split(os.Getenv("DEV_SEED_HUB_ORIGINS"), ",") {
		tenant, origin, ok := strings.Cut(strings.TrimSpace(pair), "=")
		if !ok || tenant == "" || origin == "" {
			return applicationSeedSettings{}, fmt.Errorf(
				"DEV_SEED_HUB_ORIGINS must list tenant=origin pairs, got %q", pair)
		}
		s.hubOrigins[tenant] = strings.TrimRight(origin, "/")
	}
	for _, tenant := range applicationSeedTenants {
		if s.hubOrigins[tenant] == "" {
			return applicationSeedSettings{}, fmt.Errorf("no Hub origin for %s", tenant)
		}
	}
	return s, nil
}

type seededApplicant struct {
	email, tenant string
}

type hubSession struct {
	origin, token string
}

type applicationSeeder struct {
	*orgSeeder
	settings   applicationSeedSettings
	applicants []seededApplicant
	sessions   map[string]hubSession
}

// runApplicationSeed gives each seeded Org of the tenant pipeline templates
// and applications in every state a person can drive through the portal APIs,
// from Hub users of this and the next region, so the Applications pages of
// both portals show each state. It needs the Hub profiles and Orgs seeded.
func runApplicationSeed() error {
	settings, err := loadApplicationSeedSettings()
	if err != nil {
		return err
	}
	ctx, stop := service.SignalContext()
	defer stop()
	seeder := &applicationSeeder{
		orgSeeder: &orgSeeder{
			settings: orgSeedSettings{orgsOrigin: settings.orgsOrigin, tenantID: settings.tenantID},
			client:   &http.Client{Timeout: hubProfileRequestTimeout},
		},
		settings: settings,
		sessions: map[string]hubSession{},
	}
	if seeder.applicants, err = seeder.chooseApplicants(); err != nil {
		return err
	}
	for _, org := range seededOrgs {
		domain := orgs.OrgDomain(org.domainPrefix + settings.tenantID + ".example.com")
		if err := seeder.seedOrgApplications(ctx, domain); err != nil {
			return fmt.Errorf("seed applications of %s: %w", domain, err)
		}
	}
	return nil
}

// chooseApplicants takes every user of the tenant, then every user of the next
// region, so each Org sees both local and remote applicants.
func (s *applicationSeeder) chooseApplicants() ([]seededApplicant, error) {
	var home int
	for index, tenant := range applicationSeedTenants {
		if tenant == s.settings.tenantID {
			home = index
		}
	}
	var chosen []seededApplicant
	for _, tenant := range []string{
		applicationSeedTenants[home],
		applicationSeedTenants[(home+1)%len(applicationSeedTenants)],
	} {
		fixture, err := loadHubProfileFixture(filepath.Join(s.settings.profilesDir, tenant+".json"))
		if err != nil {
			return nil, err
		}
		for _, user := range fixture.Users {
			chosen = append(chosen, seededApplicant{email: user.Email, tenant: tenant})
		}
	}
	return chosen, nil
}

func (s *applicationSeeder) hubLogin(ctx context.Context, applicant seededApplicant) (hubSession, error) {
	if session, ok := s.sessions[applicant.email]; ok {
		return session, nil
	}
	origin := s.settings.hubOrigins[applicant.tenant]
	var response hubauth.LoginAuthenticatedResponse
	if err := s.postAt(ctx, origin, "/api/hub/login", hubauth.LoginRequest{
		EmailAddress: common.EmailAddress(applicant.email),
		Password:     common.Password(devSeedHubUserPassword),
	}, "", http.StatusOK, &response); err != nil {
		return hubSession{}, fmt.Errorf("sign in %s: %w", applicant.email, err)
	}
	session := hubSession{origin: origin, token: string(response.SessionToken)}
	s.sessions[applicant.email] = session
	return session, nil
}

// hubPost sends a Hub write as the applicant. Its outcome is expected to be
// immediate: a pending operation would leave the fixture half built.
func (s *applicationSeeder) hubPost(
	ctx context.Context, applicant seededApplicant, path string, body any, want int, out any,
) error {
	session, err := s.hubLogin(ctx, applicant)
	if err != nil {
		return err
	}
	return s.postAt(ctx, session.origin, "/api/hub/"+path, body, session.token, want, out)
}

type orgApplicationSeed struct {
	*applicationSeeder
	domain orgs.OrgDomain
	admin  string
	// stages are the stages of the Opening being seeded, by name.
	stages  map[string]hiring.PipelineStage
	opening openings.OpeningNumber
	// reviewers are the interviewers every seeded interview names.
	reviewers []common.EmailAddress
}

func (s *applicationSeeder) seedOrgApplications(ctx context.Context, domain orgs.OrgDomain) error {
	admin, err := s.openingLogin(ctx, domain, "admin")
	if err != nil {
		return fmt.Errorf("sign in admin: %w", err)
	}
	seed := &orgApplicationSeed{
		applicationSeeder: s, domain: domain, admin: admin,
		reviewers: []common.EmailAddress{
			common.EmailAddress("admin@" + string(domain)),
			common.EmailAddress("recruiter@" + string(domain)),
		},
	}
	if err := seed.seedTemplates(ctx); err != nil {
		return fmt.Errorf("pipeline templates: %w", err)
	}
	if err := seed.seedEngineeringOpening(ctx); err != nil {
		return fmt.Errorf("engineering Opening: %w", err)
	}
	if err := seed.seedQuickHireOpening(ctx); err != nil {
		return fmt.Errorf("quick hire Opening: %w", err)
	}
	log.Printf("seeded applications domain=%s", domain)
	return nil
}

var engineeringStages = []hiring.PipelineStageDefinition{
	{Name: "Screen", Kind: hiring.ReviewStage},
	{Name: "Take-home exercise", Kind: hiring.AssessmentStage},
	{Name: "Panel interview", Kind: hiring.InterviewStage},
	{Name: "Final interview", Kind: hiring.InterviewStage},
	{Name: "Background checks", Kind: hiring.BackgroundCheckStage},
}

var quickHireStages = []hiring.PipelineStageDefinition{
	{Name: "Screen", Kind: hiring.ReviewStage},
	{Name: "Conversation", Kind: hiring.InterviewStage},
}

func (s *orgApplicationSeed) seedTemplates(ctx context.Context) error {
	for name, stages := range map[string][]hiring.PipelineStageDefinition{
		"Engineering hiring": engineeringStages,
		"Quick hire":         quickHireStages,
	} {
		if err := s.post(ctx, "/api/orgs/create-pipeline-template", hiring.CreatePipelineTemplateRequest{
			Name: hiring.PipelineName(name), Stages: stages,
		}, s.admin, http.StatusCreated, nil); err != nil {
			return fmt.Errorf("create %q: %w", name, err)
		}
	}
	return nil
}

// useStages gives an Opening a pipeline and remembers its stages by name.
func (s *orgApplicationSeed) useStages(
	ctx context.Context, number openings.OpeningNumber, stages []hiring.PipelineStageDefinition,
) error {
	var opening openings.OrgOpening
	if err := s.post(ctx, "/api/orgs/get-opening", openings.GetOpeningRequest{OpeningNumber: number}, s.admin, http.StatusOK, &opening); err != nil {
		return fmt.Errorf("read Opening %d: %w", number, err)
	}
	if opening.State != openings.Published {
		return fmt.Errorf("opening %d is %q, not published", number, opening.State)
	}
	inputs := make([]openings.PipelineStageInput, len(stages))
	for index, stage := range stages {
		inputs[index] = openings.PipelineStageInput{Name: stage.Name, Kind: stage.Kind}
	}
	var replaced struct {
		Stages []hiring.PipelineStage `json:"stages"`
	}
	if err := s.post(ctx, "/api/orgs/replace-opening-pipeline", openings.ReplaceOpeningPipelineRequest{
		OpeningNumber: number, Version: opening.Version, Stages: inputs,
	}, s.admin, http.StatusOK, &replaced); err != nil {
		return fmt.Errorf("replace pipeline of Opening %d: %w", number, err)
	}
	s.opening = number
	s.stages = map[string]hiring.PipelineStage{}
	for _, stage := range replaced.Stages {
		s.stages[string(stage.Name)] = stage
	}
	return nil
}

func (s *orgApplicationSeed) apply(ctx context.Context, applicant seededApplicant, note string) (orgapplications.ApplicationNumber, error) {
	request := hubapplications.ApplyToOpeningRequest{Domain: s.domain, OpeningNumber: s.opening}
	if note != "" {
		cover := orgapplications.ApplicationCoverNote(note)
		request.CoverNote = &cover
	}
	var reference hubapplications.ApplicationReference
	if err := s.hubPost(ctx, applicant, "apply-to-opening", request, http.StatusCreated, &reference); err != nil {
		return 0, fmt.Errorf("%s applies: %w", applicant.email, err)
	}
	return reference.ApplicationNumber, nil
}

func (s *orgApplicationSeed) reference(number orgapplications.ApplicationNumber) hubapplications.ApplicationReference {
	return hubapplications.ApplicationReference{Domain: s.domain, OpeningNumber: s.opening, ApplicationNumber: number}
}

func (s *orgApplicationSeed) version(ctx context.Context, number orgapplications.ApplicationNumber) (orgapplications.ApplicationVersion, error) {
	var detail orgapplications.ApplicationDetail
	if err := s.post(ctx, "/api/orgs/get-application", orgapplications.GetApplicationRequest{
		OpeningNumber: s.opening, ApplicationNumber: number,
	}, s.admin, http.StatusOK, &detail); err != nil {
		return 0, err
	}
	return detail.Version, nil
}

// act sends an Org write that names the application at its current version.
func (s *orgApplicationSeed) act(
	ctx context.Context, path string, number orgapplications.ApplicationNumber,
	build func(version orgapplications.ApplicationVersion) any,
) error {
	version, err := s.version(ctx, number)
	if err != nil {
		return fmt.Errorf("read application %d: %w", number, err)
	}
	if err := s.post(ctx, "/api/orgs/"+path, build(version), s.admin, http.StatusOK, nil); err != nil {
		return fmt.Errorf("%s on application %d: %w", path, number, err)
	}
	return nil
}

func (s *orgApplicationSeed) shortlist(ctx context.Context, number orgapplications.ApplicationNumber, stage string) error {
	target, ok := s.stages[stage]
	if !ok {
		return fmt.Errorf("no stage %q", stage)
	}
	return s.act(ctx, "shortlist-application", number, func(v orgapplications.ApplicationVersion) any {
		return orgapplications.ApplicationStageRequest{
			OpeningNumber: s.opening, ApplicationNumber: number, Version: v, StageID: target.ID,
		}
	})
}

func (s *orgApplicationSeed) plain(ctx context.Context, path string, number orgapplications.ApplicationNumber) error {
	return s.act(ctx, path, number, func(v orgapplications.ApplicationVersion) any {
		return orgapplications.ApplicationActionRequest{OpeningNumber: s.opening, ApplicationNumber: number, Version: v}
	})
}

func (s *orgApplicationSeed) scheduleInterview(ctx context.Context, number orgapplications.ApplicationNumber, in time.Duration) error {
	video := hubprofile.WebsiteURL("https://meet.example.com/interview-" + fmt.Sprint(number))
	return s.act(ctx, "schedule-interview", number, func(v orgapplications.ApplicationVersion) any {
		return orgapplications.ScheduleInterviewRequest{
			OpeningNumber: s.opening, ApplicationNumber: number, Version: v,
			InterviewDetails: orgapplications.InterviewDetails{
				StartTime:         time.Now().Add(in).Truncate(time.Hour).UTC(),
				DurationMinutes:   45,
				Mode:              orgapplications.InterviewVideo,
				VideoURL:          &video,
				InterviewerEmails: s.reviewers,
			},
		}
	})
}

func (s *orgApplicationSeed) requestConsent(ctx context.Context, number orgapplications.ApplicationNumber) error {
	return s.act(ctx, "request-background-check-consent", number, func(v orgapplications.ApplicationVersion) any {
		return orgapplications.RequestBackgroundCheckConsentRequest{
			OpeningNumber: s.opening, ApplicationNumber: number, Version: v,
			CheckTypes: []hiring.CheckType{hiring.IdentityCheck, hiring.EmploymentCheck},
		}
	})
}

func (s *orgApplicationSeed) recordCheck(ctx context.Context, number orgapplications.ApplicationNumber, checkType hiring.CheckType, outcome orgapplications.CheckOutcome) error {
	return s.act(ctx, "record-background-check-result", number, func(v orgapplications.ApplicationVersion) any {
		return orgapplications.RecordBackgroundCheckResultRequest{
			OpeningNumber: s.opening, ApplicationNumber: number, Version: v,
			CheckType: checkType, Outcome: outcome,
		}
	})
}

func (s *orgApplicationSeed) extendOffer(ctx context.Context, number orgapplications.ApplicationNumber, applicant string) error {
	var uploaded orgapplications.OfferLetterUploaded
	letter := offerLetterPDF(string(s.domain), applicant)
	if err := s.upload(ctx, "/api/orgs/upload-offer-letter", letter, s.admin, &uploaded); err != nil {
		return fmt.Errorf("upload the offer letter: %w", err)
	}
	joining := orgapplications.CalendarDate(time.Now().AddDate(0, 0, 30).UTC().Format("2006-01-02"))
	return s.act(ctx, "extend-application-offer", number, func(v orgapplications.ApplicationVersion) any {
		return orgapplications.ExtendApplicationOfferRequest{
			OpeningNumber: s.opening, ApplicationNumber: number, Version: v,
			LetterID: uploaded.LetterID, ProposedJoiningDate: &joining, RespondWithinDays: 14,
		}
	})
}

// offerNumber is the number of an application's first offer.
const offerNumber = 1

func (s *orgApplicationSeed) answerOffer(ctx context.Context, applicant seededApplicant, number orgapplications.ApplicationNumber, path string) error {
	return s.hubPost(ctx, applicant, path, hubapplications.RespondToOfferRequest{
		Domain: s.domain, OpeningNumber: s.opening, ApplicationNumber: number, OfferNumber: offerNumber,
	}, http.StatusOK, nil)
}

func (s *orgApplicationSeed) answerConsent(ctx context.Context, applicant seededApplicant, number orgapplications.ApplicationNumber, path string) error {
	var detail hubapplications.MyApplicationDetail
	if err := s.hubPost(ctx, applicant, "get-my-application", s.reference(number), http.StatusOK, &detail); err != nil {
		return err
	}
	if detail.BackgroundCheckConsent == nil {
		return fmt.Errorf("application %d has no consent request", number)
	}
	return s.hubPost(ctx, applicant, path, hubapplications.BackgroundCheckConsentRequest{
		Domain: s.domain, OpeningNumber: s.opening, ApplicationNumber: number,
		CheckNumber: detail.BackgroundCheckConsent.CheckNumber,
	}, http.StatusOK, nil)
}

func (s *orgApplicationSeed) answerInterview(ctx context.Context, applicant seededApplicant, number orgapplications.ApplicationNumber, path string, note string) error {
	request := map[string]any{
		"domain": s.domain, "opening_number": s.opening,
		"application_number": number, "interview_number": 1,
	}
	if note != "" {
		request["note"] = note
	}
	return s.hubPost(ctx, applicant, path, request, http.StatusOK, nil)
}

func (s *orgApplicationSeed) assess(ctx context.Context, number orgapplications.ApplicationNumber) error {
	score := orgapplications.AssessmentScore(86)
	return s.act(ctx, "record-assessment-result", number, func(v orgapplications.ApplicationVersion) any {
		return orgapplications.RecordAssessmentResultRequest{
			OpeningNumber: s.opening, ApplicationNumber: number, Version: v,
			Outcome: orgapplications.AssessmentPass, Score: &score,
		}
	})
}

func (s *orgApplicationSeed) join(ctx context.Context, number orgapplications.ApplicationNumber) error {
	today := orgapplications.CalendarDate(time.Now().UTC().Format("2006-01-02"))
	return s.act(ctx, "record-application-joined", number, func(v orgapplications.ApplicationVersion) any {
		return orgapplications.ApplicationJoinedOnRequest{
			OpeningNumber: s.opening, ApplicationNumber: number, Version: v, JoinedOn: today,
		}
	})
}

// seedEngineeringOpening applies one applicant per state the five-stage
// pipeline can hold, then drives each application as the Org and the
// applicant would.
func (s *orgApplicationSeed) seedEngineeringOpening(ctx context.Context) error {
	if err := s.useStages(ctx, engineeringOpening, engineeringStages); err != nil {
		return err
	}
	next := 0
	applicant := func() seededApplicant {
		chosen := s.applicants[next%len(s.applicants)]
		next++
		return chosen
	}
	type recipe struct {
		name string
		run  func(a seededApplicant, n orgapplications.ApplicationNumber) error
	}
	hub := func(path string) func(a seededApplicant, n orgapplications.ApplicationNumber) error {
		return func(a seededApplicant, n orgapplications.ApplicationNumber) error {
			return s.answerOffer(ctx, a, n, path)
		}
	}
	offered := func(a seededApplicant, n orgapplications.ApplicationNumber) error {
		if err := s.shortlist(ctx, n, "Final interview"); err != nil {
			return err
		}
		return s.extendOffer(ctx, n, a.email)
	}
	recipes := []recipe{
		{"submitted", func(seededApplicant, orgapplications.ApplicationNumber) error { return nil }},
		{"in review", func(_ seededApplicant, n orgapplications.ApplicationNumber) error {
			return s.shortlist(ctx, n, "Screen")
		}},
		{"assessed", func(_ seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := s.shortlist(ctx, n, "Take-home exercise"); err != nil {
				return err
			}
			return s.assess(ctx, n)
		}},
		{"interview awaiting an answer", func(_ seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := s.shortlist(ctx, n, "Panel interview"); err != nil {
				return err
			}
			return s.scheduleInterview(ctx, n, 48*time.Hour)
		}},
		{"interview accepted", func(a seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := s.shortlist(ctx, n, "Panel interview"); err != nil {
				return err
			}
			if err := s.scheduleInterview(ctx, n, 72*time.Hour); err != nil {
				return err
			}
			return s.answerInterview(ctx, a, n, "accept-application-interview", "")
		}},
		{"interview reschedule requested", func(a seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := s.shortlist(ctx, n, "Panel interview"); err != nil {
				return err
			}
			if err := s.scheduleInterview(ctx, n, 96*time.Hour); err != nil {
				return err
			}
			return s.answerInterview(ctx, a, n, "request-application-interview-reschedule", "Mornings suit me better.")
		}},
		{"consent requested", func(_ seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := s.shortlist(ctx, n, "Background checks"); err != nil {
				return err
			}
			return s.requestConsent(ctx, n)
		}},
		{"consent given with results", func(a seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := s.shortlist(ctx, n, "Background checks"); err != nil {
				return err
			}
			if err := s.requestConsent(ctx, n); err != nil {
				return err
			}
			if err := s.answerConsent(ctx, a, n, "give-application-background-check-consent"); err != nil {
				return err
			}
			if err := s.recordCheck(ctx, n, hiring.IdentityCheck, orgapplications.CheckClear); err != nil {
				return err
			}
			return s.recordCheck(ctx, n, hiring.EmploymentCheck, orgapplications.CheckDiscrepancy)
		}},
		{"consent declined", func(a seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := s.shortlist(ctx, n, "Background checks"); err != nil {
				return err
			}
			if err := s.requestConsent(ctx, n); err != nil {
				return err
			}
			return s.answerConsent(ctx, a, n, "decline-application-background-check-consent")
		}},
		{"offered", offered},
		{"offer accepted", func(a seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := offered(a, n); err != nil {
				return err
			}
			return hub("accept-application-offer")(a, n)
		}},
		{"offer declined", func(a seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := offered(a, n); err != nil {
				return err
			}
			return hub("decline-application-offer")(a, n)
		}},
		{"joined", func(a seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := offered(a, n); err != nil {
				return err
			}
			if err := hub("accept-application-offer")(a, n); err != nil {
				return err
			}
			return s.join(ctx, n)
		}},
		{"did not join", func(a seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := offered(a, n); err != nil {
				return err
			}
			if err := hub("accept-application-offer")(a, n); err != nil {
				return err
			}
			return s.plain(ctx, "record-application-did-not-join", n)
		}},
		{"not progressing", func(_ seededApplicant, n orgapplications.ApplicationNumber) error {
			if err := s.shortlist(ctx, n, "Screen"); err != nil {
				return err
			}
			return s.plain(ctx, "mark-application-not-progressing", n)
		}},
		{"withdrawn", func(a seededApplicant, n orgapplications.ApplicationNumber) error {
			return s.hubPost(ctx, a, "withdraw-application", s.reference(n), http.StatusOK, nil)
		}},
	}
	for _, recipe := range recipes {
		who := applicant()
		number, err := s.apply(ctx, who, "I would like to join the team: "+recipe.name+".")
		if err != nil {
			return fmt.Errorf("%s: %w", recipe.name, err)
		}
		if err := recipe.run(who, number); err != nil {
			return fmt.Errorf("%s: %w", recipe.name, err)
		}
	}
	return nil
}

// seedQuickHireOpening gives the second published role the short pipeline,
// so the Org portal shows two templates in use.
func (s *orgApplicationSeed) seedQuickHireOpening(ctx context.Context) error {
	if err := s.useStages(ctx, quickHireOpening, quickHireStages); err != nil {
		return err
	}
	for index, name := range []string{"submitted", "in review", "interview awaiting an answer"} {
		who := s.applicants[(index+3)%len(s.applicants)]
		number, err := s.apply(ctx, who, "")
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		switch name {
		case "in review":
			err = s.shortlist(ctx, number, "Screen")
		case "interview awaiting an answer":
			if err = s.shortlist(ctx, number, "Conversation"); err == nil {
				err = s.scheduleInterview(ctx, number, 48*time.Hour)
			}
		}
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return nil
}

// upload sends a PDF to the Org API.
func (s *orgSeeder) upload(ctx context.Context, path string, body []byte, bearer string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.settings.orgsOrigin+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/pdf")
	request.Header.Set("Idempotency-Key", newIdempotencyKey())
	request.Header.Set("Authorization", "Bearer "+bearer)
	return s.do(request, http.StatusCreated, out)
}

// offerLetterPDF builds a one-page PDF whose offsets are exact, so any
// viewer opens the letter a seeded applicant is sent.
func offerLetterPDF(org, applicant string) []byte {
	text := strings.NewReplacer("(", "", ")", "", "\\", "").Replace(
		fmt.Sprintf("Offer of employment from %s to %s", org, applicant))
	stream := fmt.Sprintf("BT /F1 14 Tf 72 720 Td (%s) Tj ET", text)
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	var out bytes.Buffer
	out.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects))
	for index, object := range objects {
		offsets[index] = out.Len()
		fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", index+1, object)
	}
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&out, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return out.Bytes()
}
