package main

import (
	"context"
	"fmt"
	"net/http"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	orgsauth "github.com/vetchium/src/typespec/orgs/auth"
	"github.com/vetchium/src/typespec/orgs/openings"
)

func seedValue[T any](value T) *T { return &value }

func (s *orgSeeder) openingPost(
	ctx context.Context, path string, body any, bearer string, want int,
) (openings.OrgOpening, error) {
	var opening openings.OrgOpening
	if err := s.post(ctx, "/api/orgs/"+path, body, bearer, want, &opening); err != nil {
		return openings.OrgOpening{}, err
	}
	return opening, nil
}

func (s *orgSeeder) openingLogin(ctx context.Context, domain orgs.OrgDomain, local string) (string, error) {
	var session orgsauth.LoginAuthenticatedResponse
	if err := s.post(ctx, "/api/orgs/login", orgsauth.LoginRequest{
		Domain:       domain,
		EmailAddress: common.EmailAddress(local + "@" + string(domain)),
		Password:     common.Password(devSeedHubUserPassword),
	}, "", http.StatusOK, &session); err != nil {
		return "", err
	}
	return string(session.SessionToken), nil
}

// seedOpeningTags leaves "Technical writer" untagged so the portals show a
// published Opening without tags; the researcher revision adds a tag so its
// working copy differs from live content in tags.
var seedOpeningTags = map[string][]common.OpeningTagOID{
	"Product designer":        {"ui-ux-design", "product-management"},
	"Senior product designer": {"ui-ux-design", "product-management"},
	"Data analyst":            {"data-analytics", "sql", "python"},
	"Operations lead":         {"logistics", "supply-chain-management", "project-management"},
	"Security engineer":       {"cybersecurity", "golang", "cloud-computing"},
	"Researcher":              {"artificial-intelligence", "machine-learning", "python"},
	"Senior researcher":       {"artificial-intelligence", "machine-learning", "generative-ai", "python"},
	"Account manager":         {"sales", "customer-support"},
	"Service designer":        {"ui-ux-design", "customer-support"},
}

// seedOpeningSummaries open each Opening's description with words the seeded
// Hub users' ideal jobs share, so the ideal-job match sort ranks title, tag,
// and description matches.
var seedOpeningSummaries = map[string]string{
	"Platform engineer":       "Run the cloud platform our software engineers ship on.",
	"Support specialist":      "Help customers solve problems by chat and email.",
	"Product designer":        "Shape the product experience from user research to finished design.",
	"Senior product designer": "Lead product design for our mobile app, from user research to a shared design system.",
	"Data analyst":            "Turn product and finance data into dashboards and decisions.",
	"Operations lead":         "Lead warehouse operations and logistics across the region.",
	"Security engineer":       "Protect our payments infrastructure and cloud services.",
	"Researcher":              "Research machine learning models for search and recommendation systems with our data and software engineers.",
	"Senior researcher":       "Lead machine learning research for recommendation systems and language models.",
	"Account manager":         "Grow enterprise customer accounts with our sales and finance teams.",
	"Service designer":        "Design customer support journeys across every channel.",
	"Technical writer":        "Write developer documentation and API guides for software engineers building our cloud platform and payments services.",
}

// seedOpeningContent varies the content by org and index so the published
// Openings of a tenant's seeded Orgs, the same in every tenant, cover every
// Opening search filter on both sides (OPN-TST-003). Each attribute takes its
// own offset, so the four published slots of three Orgs reach every value.
func seedOpeningContent(org, index int, title string) common.OpeningContent {
	countries := []common.CountryCode{"SG", "US", "DE", "IN"}
	currencies := []common.CurrencyCode{"SGD", "USD", "EUR", "INR"}
	arrangements := []common.OpeningWorkArrangement{common.OpeningOnSite, common.OpeningHybrid, common.OpeningRemote, common.OpeningRemote}
	employmentTypes := []common.OpeningEmploymentType{common.OpeningFullTime, common.OpeningPartTime, common.OpeningContract, common.OpeningInternship}
	experiences := []*common.OpeningExperienceYears{
		{Min: seedValue(int32(2)), Max: seedValue(int32(6))},
		{Min: seedValue(int32(5))},
		{Max: seedValue(int32(3))},
		nil,
	}
	educations := []*common.OpeningEducation{
		nil,
		seedValue(common.OpeningSecondary),
		seedValue(common.OpeningBachelor),
		seedValue(common.OpeningMaster),
		seedValue(common.OpeningDoctorate),
	}
	countryAt := (index + 2*org) % len(countries)
	country := countries[countryAt]
	arrangementAt := (index + org) % len(arrangements)
	arrangement := arrangements[arrangementAt]
	content := common.OpeningContent{
		Title: seedValue(title),
		Description: seedValue(fmt.Sprintf(
			"## About the role\n\n%s\n\n- Collaborate across regions\n- Share practical ideas\n\nRead our [working principles](https://careers.example.com/roles/%d).",
			seedOpeningSummaries[title], index,
		)),
		Language:         seedValue(common.LanguageTag("en")),
		EmployingCountry: seedValue(country),
		WorkArrangement:  seedValue(arrangement),
		EmploymentType:   seedValue(employmentTypes[(index+2*org)%len(employmentTypes)]),
		Positions:        seedValue(int32(index%3 + 1)),
		ExperienceYears:  experiences[(index+3*org)%len(experiences)],
		MinimumEducation: educations[(index+org)%len(educations)],
		Tags:             seedOpeningTags[title],
	}
	if (index+org)%3 != 0 {
		content.Salary = &common.OpeningSalary{
			Currency: currencies[countryAt],
			Min:      int64(45_000 + index*5_000),
			Max:      int64(85_000 + index*5_000),
			Period:   common.OpeningYear,
		}
	}
	switch {
	case arrangement != common.OpeningRemote:
		content.LocationDetails = seedValue("Flexible workspace near the city centre")
	case arrangementAt == 2:
		content.RemoteEligibility = &common.OpeningRemoteEligibility{Kind: common.OpeningWorldwide}
	default:
		eligible := []common.CountryCode{country}
		for _, other := range countries {
			if other != country && len(eligible) < 2 {
				eligible = append(eligible, other)
			}
		}
		content.RemoteEligibility = &common.OpeningRemoteEligibility{Kind: common.OpeningCountries, Countries: eligible}
	}
	return content
}

func (s *orgSeeder) seedOrgOpenings(ctx context.Context, org int, domain orgs.OrgDomain, adminToken string) error {
	recruiterToken, err := s.openingLogin(ctx, domain, "recruiter")
	if err != nil {
		return fmt.Errorf("sign in recruiter: %w", err)
	}
	manager := common.EmailAddress("admin@" + string(domain))
	recruiter := common.EmailAddress("recruiter@" + string(domain))
	create := func(index int, title string, complete bool) (openings.OrgOpening, error) {
		content := seedOpeningContent(org, index, title)
		request := openings.CreateOpeningRequest{Content: &content, TeamMemberEmails: []common.EmailAddress{}}
		if !complete {
			request.Content = &common.OpeningContent{Title: seedValue(title)}
		} else {
			request.HiringManagerEmail = &manager
			request.RecruiterEmail = &recruiter
		}
		return s.openingPost(ctx, "create-opening", request, adminToken, http.StatusCreated)
	}
	change := func(opening openings.OrgOpening, kind openings.OpeningRequestKind, bearer string) (openings.OrgOpening, error) {
		return s.openingPost(ctx, "request-opening-change", openings.RequestOpeningChangeRequest{
			OpeningNumber: opening.OpeningNumber, Version: opening.Version, Kind: kind,
		}, bearer, http.StatusOK)
	}
	publish := func(index int, title string) (openings.OrgOpening, error) {
		opening, err := create(index, title, true)
		if err != nil {
			return opening, err
		}
		return change(opening, openings.PublishRequest, adminToken)
	}
	// Plain job titles, because Hub users see them; the Orgs portal tags each
	// Opening with its state.
	if _, err := create(0, "Platform engineer", false); err != nil {
		return fmt.Errorf("draft: %w", err)
	}
	discarded, err := create(1, "Support specialist", false)
	if err != nil {
		return fmt.Errorf("discarded draft: %w", err)
	}
	if _, err := s.openingPost(ctx, "discard-opening", openings.DiscardOpeningRequest{
		OpeningNumber: discarded.OpeningNumber, Version: discarded.Version,
	}, adminToken, http.StatusOK); err != nil {
		return fmt.Errorf("discard draft: %w", err)
	}

	revised, err := publish(2, "Product designer")
	if err != nil {
		return fmt.Errorf("published: %w", err)
	}
	revision := seedOpeningContent(org, 2, "Senior product designer")
	revised, err = s.openingPost(ctx, "save-opening-working-copy", openings.SaveOpeningWorkingCopyRequest{
		OpeningNumber: revised.OpeningNumber, Version: revised.Version, Content: &revision,
	}, adminToken, http.StatusOK)
	if err != nil {
		return fmt.Errorf("save revision: %w", err)
	}
	if _, err := change(revised, openings.ReviseRequest, adminToken); err != nil {
		return fmt.Errorf("apply revision: %w", err)
	}

	paused, err := publish(3, "Data analyst")
	if err != nil {
		return fmt.Errorf("publish paused role: %w", err)
	}
	if _, err := change(paused, openings.PauseRequest, adminToken); err != nil {
		return fmt.Errorf("pause: %w", err)
	}
	closed, err := publish(4, "Operations lead")
	if err != nil {
		return fmt.Errorf("publish closed role: %w", err)
	}
	if _, err := change(closed, openings.CloseRequest, adminToken); err != nil {
		return fmt.Errorf("close: %w", err)
	}

	pendingPublish, err := create(5, "Security engineer", true)
	if err != nil {
		return fmt.Errorf("create pending publish: %w", err)
	}
	if _, err := change(pendingPublish, openings.PublishRequest, recruiterToken); err != nil {
		return fmt.Errorf("request publish: %w", err)
	}
	pendingRevise, err := publish(6, "Researcher")
	if err != nil {
		return fmt.Errorf("publish revision target: %w", err)
	}
	working := seedOpeningContent(org, 6, "Senior researcher")
	pendingRevise, err = s.openingPost(ctx, "save-opening-working-copy", openings.SaveOpeningWorkingCopyRequest{
		OpeningNumber: pendingRevise.OpeningNumber, Version: pendingRevise.Version, Content: &working,
	}, recruiterToken, http.StatusOK)
	if err != nil {
		return fmt.Errorf("save pending revision: %w", err)
	}
	if _, err := change(pendingRevise, openings.ReviseRequest, recruiterToken); err != nil {
		return fmt.Errorf("request revise: %w", err)
	}
	pendingPause, err := publish(7, "Account manager")
	if err != nil {
		return fmt.Errorf("publish pause target: %w", err)
	}
	if _, err := change(pendingPause, openings.PauseRequest, recruiterToken); err != nil {
		return fmt.Errorf("request pause: %w", err)
	}
	pendingReopen, err := publish(8, "Service designer")
	if err != nil {
		return fmt.Errorf("publish reopen target: %w", err)
	}
	pendingReopen, err = change(pendingReopen, openings.PauseRequest, adminToken)
	if err != nil {
		return fmt.Errorf("pause reopen target: %w", err)
	}
	if _, err := change(pendingReopen, openings.ReopenRequest, recruiterToken); err != nil {
		return fmt.Errorf("request reopen: %w", err)
	}
	pendingClose, err := publish(9, "Technical writer")
	if err != nil {
		return fmt.Errorf("publish close target: %w", err)
	}
	if _, err := change(pendingClose, openings.CloseRequest, recruiterToken); err != nil {
		return fmt.Errorf("request close: %w", err)
	}
	return nil
}
