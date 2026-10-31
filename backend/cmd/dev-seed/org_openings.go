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

func seedOpeningContent(index int, title string) common.OpeningContent {
	countries := []common.CountryCode{"SG", "US", "DE", "IN"}
	currencies := []common.CurrencyCode{"SGD", "USD", "EUR", "INR"}
	arrangements := []common.OpeningWorkArrangement{common.OpeningHybrid, common.OpeningRemote, common.OpeningOnSite}
	country := countries[index%len(countries)]
	arrangement := arrangements[index%len(arrangements)]
	content := common.OpeningContent{
		Title: seedValue(title),
		Description: seedValue(fmt.Sprintf(
			"## About the role\n\nBuild reliable services with a welcoming team.\n\n- Collaborate across regions\n- Share practical ideas\n\nRead our [working principles](https://careers.example.com/roles/%d).", index,
		)),
		Language:         seedValue(common.LanguageTag("en")),
		EmployingCountry: seedValue(country),
		WorkArrangement:  seedValue(arrangement),
		EmploymentType:   seedValue([]common.OpeningEmploymentType{common.OpeningFullTime, common.OpeningContract, common.OpeningPartTime}[index%3]),
		Positions:        seedValue(int32(index%3 + 1)),
		Salary: &common.OpeningSalary{
			Currency: currencies[index%len(currencies)],
			Min:      int64(45_000 + index*5_000),
			Max:      int64(85_000 + index*5_000),
			Period:   common.OpeningYear,
		},
	}
	if arrangement == common.OpeningRemote {
		content.RemoteEligibility = &common.OpeningRemoteEligibility{Kind: common.OpeningWorldwide}
	} else {
		content.LocationDetails = seedValue("Flexible workspace near the city centre")
	}
	return content
}

func (s *orgSeeder) seedOrgOpenings(ctx context.Context, domain orgs.OrgDomain, adminToken string) error {
	recruiterToken, err := s.openingLogin(ctx, domain, "recruiter")
	if err != nil {
		return fmt.Errorf("sign in recruiter: %w", err)
	}
	manager := common.EmailAddress("admin@" + string(domain))
	recruiter := common.EmailAddress("recruiter@" + string(domain))
	create := func(index int, title string, complete bool) (openings.OrgOpening, error) {
		content := seedOpeningContent(index, title)
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
	revision := seedOpeningContent(2, "Senior product designer")
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
	working := seedOpeningContent(6, "Senior researcher")
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
