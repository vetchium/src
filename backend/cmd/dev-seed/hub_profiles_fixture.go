package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	hubprofile "github.com/vetchium/src/typespec/hub/profile"
	hubsubscriptions "github.com/vetchium/src/typespec/hub/subscriptions"
)

// hubProfileFixtureFile is the shape of each dev/hub-seed-profiles/<tenant>.json
// file: a hand-edited, tenant-local list of Hub users to seed through the Hub
// API. Field names are camelCase JSON to match this repository's JSON
// convention; they are translated into the contract's snake_case wire types
// when calling the API.
type hubProfileFixtureFile struct {
	Users []hubUserFixture `json:"users"`
}

type hubUserFixture struct {
	Email             string `json:"email"`
	DisplayName       string `json:"displayName"`
	PreferredLanguage string `json:"preferredLanguage"`
	ResidentCountry   string `json:"residentCountry"`
	Biography         string `json:"biography,omitempty"`

	// Plan is a HubPlan OID. BillingInterval is required exactly when Plan is
	// paid, matching RequiresBillingInterval.
	Plan            string `json:"plan"`
	BillingInterval string `json:"billingInterval,omitempty"`

	// ProfilePicture, when set, names an avatar file in this fixture file's
	// own directory (dev/hub-seed-profiles/). It is only valid for a plan at
	// or above Silver.
	ProfilePicture string `json:"profilePicture,omitempty"`

	WorkExperience []workExperienceFixture  `json:"workExperience,omitempty"`
	Education      []educationFixture       `json:"education,omitempty"`
	Certifications []certificationFixture   `json:"certifications,omitempty"`
	Languages      []languageAbilityFixture `json:"languages,omitempty"`

	// Websites are normalized HTTPS URLs, listed in the order they are added.
	Websites []string `json:"websites,omitempty"`
}

type workExperienceFixture struct {
	EmployerDomain string `json:"employerDomain"`
	JobTitle       string `json:"jobTitle"`
	StartMonth     string `json:"startMonth"`
	EndMonth       string `json:"endMonth,omitempty"`
	Location       string `json:"location,omitempty"`
	Description    string `json:"description,omitempty"`
}

type educationFixture struct {
	InstitutionDomain string `json:"institutionDomain"`
	Degree            string `json:"degree"`
	Title             string `json:"title,omitempty"`
	SupportingText    string `json:"supportingText,omitempty"`
	StartMonth        string `json:"startMonth,omitempty"`
	EndMonth          string `json:"endMonth,omitempty"`
}

type certificationFixture struct {
	Title         string `json:"title"`
	CredentialURL string `json:"credentialUrl"`
}

type languageAbilityFixture struct {
	Ability     string `json:"ability"`
	LanguageTag string `json:"languageTag"`
}

func loadHubProfileFixture(path string) (hubProfileFixtureFile, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return hubProfileFixtureFile{}, fmt.Errorf("read %s: %w", path, err)
	}
	var fixture hubProfileFixtureFile
	if err := json.Unmarshal(raw, &fixture); err != nil {
		return hubProfileFixtureFile{}, fmt.Errorf("parse %s: %w", path, err)
	}
	if err := validateHubProfileFixture(fixture); err != nil {
		return hubProfileFixtureFile{}, fmt.Errorf("%s: %w", path, err)
	}
	return fixture, nil
}

// validateHubProfileFixture rejects a fixture file before any API call is
// made, using the same contract validators the Hub API enforces server-side.
// A hand-edited fixture then fails fast with a field-level reason instead of
// an opaque HTTP error partway through seeding a user.
func validateHubProfileFixture(fixture hubProfileFixtureFile) error {
	seenEmails := make(map[string]struct{}, len(fixture.Users))
	for _, user := range fixture.Users {
		if _, exists := seenEmails[user.Email]; exists {
			return fmt.Errorf("duplicate email %q", user.Email)
		}
		seenEmails[user.Email] = struct{}{}
		if err := validateHubUserFixture(user); err != nil {
			return fmt.Errorf("user %q: %w", user.Email, err)
		}
	}
	return nil
}

func validateHubUserFixture(user hubUserFixture) error {
	if !common.IsEmailAddress(common.EmailAddress(user.Email)) {
		return fmt.Errorf("invalid email")
	}
	if !common.IsDisplayName(common.DisplayName(user.DisplayName)) {
		return fmt.Errorf("invalid displayName")
	}
	if !hub.IsFrontendLocale(hub.FrontendLocale(user.PreferredLanguage)) {
		return fmt.Errorf("invalid preferredLanguage %q", user.PreferredLanguage)
	}
	if !common.IsCountryCode(common.CountryCode(user.ResidentCountry)) {
		return fmt.Errorf("invalid residentCountry %q", user.ResidentCountry)
	}
	if err := validateHubUserPlan(user); err != nil {
		return err
	}
	if user.Biography != "" &&
		len([]rune(user.Biography)) > 2000 {
		return fmt.Errorf("biography exceeds 2000 code points")
	}
	for _, entry := range user.WorkExperience {
		if err := validateWorkExperienceFixture(entry); err != nil {
			return fmt.Errorf("work experience %q: %w", entry.EmployerDomain, err)
		}
	}
	for _, entry := range user.Education {
		if err := validateEducationFixture(entry); err != nil {
			return fmt.Errorf(
				"education %q: %w", entry.InstitutionDomain, err,
			)
		}
	}
	for _, entry := range user.Certifications {
		if err := validateCertificationFixture(entry); err != nil {
			return fmt.Errorf("certification %q: %w", entry.Title, err)
		}
	}
	for _, entry := range user.Languages {
		if err := validateLanguageFixture(entry); err != nil {
			return fmt.Errorf("language %q: %w", entry.LanguageTag, err)
		}
	}
	return validateWebsiteFixtures(user.Websites)
}

func validateWebsiteFixtures(websites []string) error {
	if len(websites) > hubprofile.MaxWebsites {
		return fmt.Errorf(
			"%d websites exceed the limit of %d",
			len(websites), hubprofile.MaxWebsites,
		)
	}
	seen := make(map[string]struct{}, len(websites))
	for _, website := range websites {
		if !hubprofile.IsWebsiteURL(hubprofile.WebsiteURL(website)) {
			return fmt.Errorf("invalid website %q", website)
		}
		if _, exists := seen[website]; exists {
			return fmt.Errorf("duplicate website %q", website)
		}
		seen[website] = struct{}{}
	}
	return nil
}

func validateHubUserPlan(user hubUserFixture) error {
	planOID := hubsubscriptions.PlanOID(user.Plan)
	if !hubsubscriptions.IsPlan(planOID) {
		return fmt.Errorf("invalid plan %q", user.Plan)
	}
	plan := hubsubscriptions.Plan(user.Plan)
	requiresInterval := hubsubscriptions.RequiresBillingInterval(plan)
	hasInterval := user.BillingInterval != ""
	if requiresInterval != hasInterval {
		return fmt.Errorf(
			"billingInterval must be set only for a paid plan",
		)
	}
	if hasInterval && !hubsubscriptions.IsBillingInterval(
		hubsubscriptions.BillingInterval(user.BillingInterval),
	) {
		return fmt.Errorf("invalid billingInterval %q", user.BillingInterval)
	}
	if user.ProfilePicture != "" &&
		!hubsubscriptions.Includes(planOID, hubsubscriptions.SilverTier) {
		return fmt.Errorf(
			"profilePicture requires a plan at or above %s",
			hubsubscriptions.SilverTier,
		)
	}
	return nil
}

func validateWorkExperienceFixture(entry workExperienceFixture) error {
	if !common.IsProfessionalDomain(
		common.ProfessionalDomain(entry.EmployerDomain),
	) {
		return fmt.Errorf("invalid employerDomain")
	}
	if !hubprofile.IsProfileTitle(hubprofile.ProfileTitle(entry.JobTitle)) {
		return fmt.Errorf("invalid jobTitle %q", entry.JobTitle)
	}
	if !hubprofile.IsProfileMonth(hubprofile.ProfileMonth(entry.StartMonth)) {
		return fmt.Errorf("invalid startMonth %q", entry.StartMonth)
	}
	if entry.EndMonth != "" &&
		!hubprofile.IsProfileMonth(hubprofile.ProfileMonth(entry.EndMonth)) {
		return fmt.Errorf("invalid endMonth %q", entry.EndMonth)
	}
	return nil
}

func validateEducationFixture(entry educationFixture) error {
	if !common.IsProfessionalDomain(
		common.ProfessionalDomain(entry.InstitutionDomain),
	) {
		return fmt.Errorf("invalid institutionDomain")
	}
	if !hubprofile.IsProfileTitle(hubprofile.ProfileTitle(entry.Degree)) {
		return fmt.Errorf("invalid degree %q", entry.Degree)
	}
	if entry.StartMonth != "" &&
		!hubprofile.IsProfileMonth(hubprofile.ProfileMonth(entry.StartMonth)) {
		return fmt.Errorf("invalid startMonth %q", entry.StartMonth)
	}
	if entry.EndMonth != "" &&
		!hubprofile.IsProfileMonth(hubprofile.ProfileMonth(entry.EndMonth)) {
		return fmt.Errorf("invalid endMonth %q", entry.EndMonth)
	}
	return nil
}

func validateCertificationFixture(entry certificationFixture) error {
	if !hubprofile.IsProfileTitle(hubprofile.ProfileTitle(entry.Title)) {
		return fmt.Errorf("invalid title %q", entry.Title)
	}
	if !hubprofile.IsCredentialURL(
		hubprofile.CredentialURL(entry.CredentialURL),
	) {
		return fmt.Errorf("invalid credentialUrl %q", entry.CredentialURL)
	}
	return nil
}

func validateLanguageFixture(entry languageAbilityFixture) error {
	if !hubprofile.IsLanguageAbility(hubprofile.LanguageAbility(entry.Ability)) {
		return fmt.Errorf("invalid ability %q", entry.Ability)
	}
	if !hubprofile.IsLanguageTag(hubprofile.LanguageTag(entry.LanguageTag)) {
		return fmt.Errorf("invalid languageTag %q", entry.LanguageTag)
	}
	return nil
}
