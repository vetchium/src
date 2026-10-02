package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	hubprofile "github.com/vetchium/src/typespec/hub/profile"
	hubsubscriptions "github.com/vetchium/src/typespec/hub/subscriptions"
	"golang.org/x/sync/errgroup"

	"backend/internal/service"
)

// devSeedHubUserPassword is the shared fixture password every seeded Hub user
// account uses. It matches the length and shape of the administrator fixture
// password documented in db/README.md, so a developer can log in to any
// seeded profile in hub-ui with one known, documented password.
const devSeedHubUserPassword = "DevPassword123$"

const (
	hubProfileRequestTimeout = 10 * time.Second
	mailpitPollTimeout       = 20 * time.Second
	mailpitPollInterval      = 250 * time.Millisecond
)

var signupTokenPattern = regexp.MustCompile(
	`complete-signup\?region=[a-z0-9-]+&token=([0-9a-f]{64})`,
)

type hubProfileSettings struct {
	hubOrigin, mailpitOrigin, fixtureFile string
}

func loadHubProfileSettings() (hubProfileSettings, error) {
	var s hubProfileSettings
	for name, target := range map[string]*string{
		"DEV_SEED_HUB_ORIGIN":        &s.hubOrigin,
		"DEV_SEED_MAILPIT_URL":       &s.mailpitOrigin,
		"DEV_SEED_HUB_PROFILES_FILE": &s.fixtureFile,
	} {
		value := strings.TrimSpace(os.Getenv(name))
		if value == "" {
			return hubProfileSettings{}, fmt.Errorf("missing %s", name)
		}
		*target = value
	}
	s.hubOrigin = strings.TrimRight(s.hubOrigin, "/")
	s.mailpitOrigin = strings.TrimRight(s.mailpitOrigin, "/")
	return s, nil
}

func runHubProfileSeed() error {
	settings, err := loadHubProfileSettings()
	if err != nil {
		return err
	}
	fixture, err := loadHubProfileFixture(settings.fixtureFile)
	if err != nil {
		return err
	}
	ctx, stop := service.SignalContext()
	defer stop()

	client := &hubProfileClient{
		hubOrigin:     settings.hubOrigin,
		mailpitOrigin: settings.mailpitOrigin,
		// Avatars referenced by a fixture file live beside it, so a picture
		// filename resolves relative to the fixture's own directory.
		avatarDir: filepath.Dir(settings.fixtureFile),
		client:    &http.Client{Timeout: hubProfileRequestTimeout},
	}
	var eg errgroup.Group
	for _, user := range fixture.Users {
		u := user
		eg.Go(func() error {
			if err := client.seedUser(ctx, u); err != nil {
				return fmt.Errorf("seed hub user %q: %w", u.Email, err)
			}
			return nil
		})
	}
	return eg.Wait()
}

type hubProfileClient struct {
	hubOrigin, mailpitOrigin, avatarDir string
	client                              *http.Client
}

// seedUser drives one fixture user through the same signup and profile-write
// path a real Hub user's browser would use: request signup, follow the
// verification link Mailpit captured, complete signup, log in, then write
// every profile section the fixture supplies.
func (c *hubProfileClient) seedUser(
	ctx context.Context, user hubUserFixture,
) error {
	if err := c.requestSignup(ctx, user); err != nil {
		return fmt.Errorf("request signup: %w", err)
	}
	token, err := c.awaitSignupToken(ctx, user.Email)
	if err != nil {
		return fmt.Errorf("await signup token: %w", err)
	}
	handle, err := c.completeSignup(ctx, token)
	if err != nil {
		return fmt.Errorf("complete signup: %w", err)
	}
	session, err := c.login(ctx, user.Email)
	if err != nil {
		return fmt.Errorf("login: %w", err)
	}
	if hubsubscriptions.Plan(user.Plan) != hubsubscriptions.FreeTier {
		if err := c.setSubscriptionPlan(ctx, session, user); err != nil {
			return fmt.Errorf("set subscription plan: %w", err)
		}
	}
	if err := c.setPublicFields(ctx, session, user); err != nil {
		return fmt.Errorf("set public fields: %w", err)
	}
	for _, website := range user.Websites {
		if err := c.saveWebsite(ctx, session, website); err != nil {
			return fmt.Errorf("save website %q: %w", website, err)
		}
	}
	for _, entry := range user.WorkExperience {
		if err := c.saveWorkExperience(ctx, session, entry); err != nil {
			return fmt.Errorf(
				"save work experience %q: %w", entry.EmployerDomain, err,
			)
		}
	}
	for _, entry := range user.Education {
		if err := c.saveEducation(ctx, session, entry); err != nil {
			return fmt.Errorf(
				"save education %q: %w", entry.InstitutionDomain, err,
			)
		}
	}
	for _, entry := range user.Certifications {
		if err := c.saveCertification(ctx, session, entry); err != nil {
			return fmt.Errorf("save certification %q: %w", entry.Title, err)
		}
	}
	for _, entry := range user.Languages {
		if err := c.addLanguage(ctx, session, entry); err != nil {
			return fmt.Errorf("add language %q: %w", entry.LanguageTag, err)
		}
	}
	if user.ProfilePicture != "" {
		if err := c.uploadPicture(ctx, session, user.ProfilePicture); err != nil {
			return fmt.Errorf("upload picture: %w", err)
		}
	}
	log.Printf("seeded Hub profile handle=%s email=%s region=%s", handle, user.Email, user.ResidentCountry)
	return nil
}

func (c *hubProfileClient) requestSignup(
	ctx context.Context, user hubUserFixture,
) error {
	request := hubauth.RequestSignupRequest{
		EmailAddress:      common.EmailAddress(user.Email),
		DisplayName:       common.DisplayName(user.DisplayName),
		PreferredLanguage: hub.FrontendLocale(user.PreferredLanguage),
		ResidentCountry:   common.CountryCode(user.ResidentCountry),
	}
	status, body, err := c.post(
		ctx, "/api/hub/request-signup", "", newIdempotencyKey(), request,
	)
	if err != nil {
		return err
	}
	if status != http.StatusAccepted {
		return fmt.Errorf("returned %d: %s", status, body)
	}
	return nil
}

// awaitSignupToken polls Mailpit, which every tenant's mail sender is
// configured to use in development, for the verification email the signup
// request queued, the same way the Playwright Hub signup helper does.
func (c *hubProfileClient) awaitSignupToken(
	ctx context.Context, email string,
) (string, error) {
	mailbox := fmt.Sprintf(
		"%s/view/latest.txt?query=%s",
		c.mailpitOrigin, url.QueryEscape("to:"+email),
	)
	expectedLink := "/complete-signup?region="
	deadline := time.Now().Add(mailpitPollTimeout)
	for {
		if body, ok := c.fetchMailbox(ctx, mailbox); ok &&
			bytes.Contains(body, []byte(expectedLink)) {
			if match := signupTokenPattern.FindSubmatch(body); match != nil {
				return string(match[1]), nil
			}
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf(
				"no signup email for %q within %s", email, mailpitPollTimeout,
			)
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(mailpitPollInterval):
		}
	}
}

func (c *hubProfileClient) fetchMailbox(
	ctx context.Context, mailbox string,
) ([]byte, bool) {
	request, err := http.NewRequestWithContext(
		ctx, http.MethodGet, mailbox, nil,
	)
	if err != nil {
		return nil, false
	}
	result, err := c.client.Do(request)
	if err != nil {
		return nil, false
	}
	defer func() { _ = result.Body.Close() }()
	if result.StatusCode != http.StatusOK {
		return nil, false
	}
	body, err := io.ReadAll(io.LimitReader(result.Body, 1<<20))
	if err != nil {
		return nil, false
	}
	return body, true
}

func (c *hubProfileClient) completeSignup(
	ctx context.Context, token string,
) (hub.HubHandle, error) {
	request := hubauth.CompleteSignupRequest{
		SignupToken: hubauth.HubSignupToken(token),
		Password:    common.NewPassword(devSeedHubUserPassword),
	}
	status, body, err := c.post(
		ctx, "/api/hub/complete-signup", "", newIdempotencyKey(), request,
	)
	if err != nil {
		return "", err
	}
	if status != http.StatusCreated {
		return "", fmt.Errorf("returned %d: %s", status, body)
	}
	var response hubauth.CompleteSignupResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	return response.Handle, nil
}

func (c *hubProfileClient) login(
	ctx context.Context, email string,
) (string, error) {
	request := hubauth.LoginRequest{
		EmailAddress: common.EmailAddress(email),
		Password:     common.Password(devSeedHubUserPassword),
	}
	status, body, err := c.post(ctx, "/api/hub/login", "", "", request)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("returned %d: %s", status, body)
	}
	var response hubauth.LoginAuthenticatedResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	if response.AuthenticationState != hubauth.AuthenticationStateAuthenticated {
		return "", fmt.Errorf(
			"login unexpectedly required %q", response.AuthenticationState,
		)
	}
	return string(response.SessionToken), nil
}

func (c *hubProfileClient) setSubscriptionPlan(
	ctx context.Context, session string, user hubUserFixture,
) error {
	request := hubsubscriptions.SetSubscriptionPlanRequest{
		PlanOID: hubsubscriptions.Plan(user.Plan),
		BillingInterval: hubsubscriptions.OptionalBillingInterval{
			Value:   hubsubscriptions.BillingInterval(user.BillingInterval),
			Present: true,
		},
	}
	status, body, err := c.post(
		ctx, "/api/hub/set-subscription-plan", session, newIdempotencyKey(),
		request,
	)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("returned %d: %s", status, body)
	}
	return nil
}

func (c *hubProfileClient) setPublicFields(
	ctx context.Context, session string, user hubUserFixture,
) error {
	var biography *hubprofile.ProfileLongText
	if user.Biography != "" {
		value := hubprofile.ProfileLongText(user.Biography)
		biography = &value
	}
	return c.writeProfile(ctx, session, "/api/hub/profile/set-public-fields",
		hubprofile.SetPublicFieldsRequest{
			DisplayName: common.DisplayName(user.DisplayName),
			Biography:   biography,
		},
	)
}

func (c *hubProfileClient) saveWorkExperience(
	ctx context.Context, session string, entry workExperienceFixture,
) error {
	request := hubprofile.SaveWorkExperienceRequest{
		EmployerDomain: common.ProfessionalDomain(entry.EmployerDomain),
		JobTitle:       hubprofile.ProfileTitle(entry.JobTitle),
		StartMonth:     hubprofile.ProfileMonth(entry.StartMonth),
	}
	if entry.EndMonth != "" {
		month := hubprofile.ProfileMonth(entry.EndMonth)
		request.EndMonth = &month
	}
	if entry.Location != "" {
		location := hubprofile.ProfileLocation(entry.Location)
		request.Location = &location
	}
	if entry.Description != "" {
		description := hubprofile.ProfileLongText(entry.Description)
		request.Description = &description
	}
	return c.writeProfile(
		ctx, session, "/api/hub/profile/save-work-experience", request,
	)
}

func (c *hubProfileClient) saveEducation(
	ctx context.Context, session string, entry educationFixture,
) error {
	request := hubprofile.SaveEducationalQualificationRequest{
		InstitutionDomain: common.ProfessionalDomain(entry.InstitutionDomain),
		Degree:            hubprofile.ProfileTitle(entry.Degree),
	}
	if entry.Title != "" {
		title := hubprofile.ProfileTitle(entry.Title)
		request.Title = &title
	}
	if entry.SupportingText != "" {
		text := hubprofile.EducationSupportingText(entry.SupportingText)
		request.SupportingText = &text
	}
	if entry.StartMonth != "" {
		month := hubprofile.ProfileMonth(entry.StartMonth)
		request.StartMonth = &month
	}
	if entry.EndMonth != "" {
		month := hubprofile.ProfileMonth(entry.EndMonth)
		request.EndMonth = &month
	}
	return c.writeProfile(
		ctx, session, "/api/hub/profile/save-education", request,
	)
}

func (c *hubProfileClient) saveCertification(
	ctx context.Context, session string, entry certificationFixture,
) error {
	return c.writeProfile(
		ctx, session, "/api/hub/profile/save-certification",
		hubprofile.SaveCertificationRequest{
			Title:         hubprofile.ProfileTitle(entry.Title),
			CredentialURL: hubprofile.CredentialURL(entry.CredentialURL),
		},
	)
}

func (c *hubProfileClient) saveWebsite(
	ctx context.Context, session, website string,
) error {
	return c.writeProfile(
		ctx, session, "/api/hub/profile/save-website",
		hubprofile.SaveWebsiteRequest{URL: hubprofile.WebsiteURL(website)},
	)
}

func (c *hubProfileClient) addLanguage(
	ctx context.Context, session string, entry languageAbilityFixture,
) error {
	return c.writeProfile(
		ctx, session, "/api/hub/profile/add-language",
		hubprofile.ChangeLanguageAbilityRequest{
			Ability:     hubprofile.LanguageAbility(entry.Ability),
			LanguageTag: hubprofile.LanguageTag(entry.LanguageTag),
		},
	)
}

func (c *hubProfileClient) uploadPicture(
	ctx context.Context, session, filename string,
) error {
	path := filepath.Join(c.avatarDir, filename)
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	contentType := hubprofile.PictureJPEG
	if strings.HasSuffix(strings.ToLower(filename), ".png") {
		contentType = hubprofile.PicturePNG
	}
	status, body, err := c.postBytes(
		ctx, "/api/hub/profile/picture/upload", session,
		newIdempotencyKey(), string(contentType), data,
	)
	if err != nil {
		return err
	}
	if status != http.StatusNoContent {
		return fmt.Errorf("returned %d: %s", status, body)
	}
	return nil
}

// writeProfile issues one authenticated profile-write POST and treats 204 as
// the only success, matching every ProfileWriteResult and
// ProfileEntryWriteResult response in typespec/hub/profile/public.tsp.
func (c *hubProfileClient) writeProfile(
	ctx context.Context, session, path string, request any,
) error {
	status, body, err := c.post(
		ctx, path, session, newIdempotencyKey(), request,
	)
	if err != nil {
		return err
	}
	if status != http.StatusNoContent {
		return fmt.Errorf("%s returned %d: %s", path, status, body)
	}
	return nil
}

func (c *hubProfileClient) post(
	ctx context.Context, path, bearer, idempotencyKey string, request any,
) (int, []byte, error) {
	payload, err := json.Marshal(request)
	if err != nil {
		return 0, nil, err
	}
	return c.postBytes(
		ctx, path, bearer, idempotencyKey, "application/json", payload,
	)
}

func (c *hubProfileClient) postBytes(
	ctx context.Context, path, bearer, idempotencyKey, contentType string,
	body []byte,
) (int, []byte, error) {
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.hubOrigin+path, bytes.NewReader(body),
	)
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Content-Type", contentType)
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	result, err := c.client.Do(request)
	if err != nil {
		return 0, nil, fmt.Errorf("POST %s: %w", path, err)
	}
	defer func() { _ = result.Body.Close() }()
	responseBody, err := io.ReadAll(io.LimitReader(result.Body, 1<<20))
	if err != nil {
		return result.StatusCode, nil, fmt.Errorf(
			"read %s response: %w", path, err,
		)
	}
	return result.StatusCode, responseBody, nil
}

// newIdempotencyKey returns a fresh key meeting IdempotencyKey's 22-128
// URL-safe ASCII character contract. Hex encoding keeps every character
// alphanumeric, so no separate first-character check is needed.
func newIdempotencyKey() string {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("crypto/rand unavailable: %v", err))
	}
	return "devseed" + hex.EncodeToString(buf)
}
