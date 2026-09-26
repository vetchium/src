package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validFixtureUser() hubUserFixture {
	return hubUserFixture{
		Email:             "alice@sgp.example",
		DisplayName:       "Alice Tan",
		PreferredLanguage: "en-US",
		ResidentCountry:   "SG",
		Plan:              "hub-free-tier",
		WorkExperience: []workExperienceFixture{{
			EmployerDomain: "grab.com",
			JobTitle:       "Software Engineer",
			StartMonth:     "2020-01",
		}},
		Education: []educationFixture{{
			InstitutionDomain: "nus.edu.sg",
			Degree:            "BEng Computer Science",
		}},
		Certifications: []certificationFixture{{
			Title:         "AWS Certified Solutions Architect",
			CredentialURL: "https://www.credly.com/badges/example",
		}},
		Languages: []languageAbilityFixture{{
			Ability:     "speaking",
			LanguageTag: "en",
		}},
		Websites: []string{
			"https://github.com/alice-tan",
			"https://alice.example.com",
		},
	}
}

func TestValidateHubUserFixtureAcceptsWellFormedUser(t *testing.T) {
	if err := validateHubUserFixture(validFixtureUser()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateHubUserFixtureRejectsBadEmail(t *testing.T) {
	user := validFixtureUser()
	user.Email = "not-an-email"
	if err := validateHubUserFixture(user); err == nil {
		t.Fatal("expected an error for an invalid email")
	}
}

func TestValidateHubUserFixtureRejectsUnknownPlan(t *testing.T) {
	user := validFixtureUser()
	user.Plan = "hub-gold-tier"
	if err := validateHubUserFixture(user); err == nil {
		t.Fatal("expected an error for an unknown plan")
	}
}

func TestValidateHubUserFixtureRequiresBillingIntervalForPaidPlan(t *testing.T) {
	user := validFixtureUser()
	user.Plan = "hub-silver-tier"
	if err := validateHubUserFixture(user); err == nil {
		t.Fatal("expected an error for a paid plan without a billing interval")
	}
}

func TestValidateHubUserFixtureRejectsBillingIntervalOnFreeTier(t *testing.T) {
	user := validFixtureUser()
	user.BillingInterval = "month"
	if err := validateHubUserFixture(user); err == nil {
		t.Fatal("expected an error for a free-tier billing interval")
	}
}

func TestValidateHubUserFixtureRejectsPictureBelowSilver(t *testing.T) {
	user := validFixtureUser()
	user.ProfilePicture = "avatar1.jpg"
	if err := validateHubUserFixture(user); err == nil {
		t.Fatal("expected an error for a free-tier profile picture")
	}
}

func TestValidateHubUserFixtureAcceptsPictureOnSilver(t *testing.T) {
	user := validFixtureUser()
	user.Plan = "hub-silver-tier"
	user.BillingInterval = "month"
	user.ProfilePicture = "avatar1.jpg"
	if err := validateHubUserFixture(user); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateHubUserFixtureRejectsInvalidWorkExperienceMonth(t *testing.T) {
	user := validFixtureUser()
	user.WorkExperience[0].StartMonth = "2099-01"
	if err := validateHubUserFixture(user); err == nil {
		t.Fatal("expected an error for a future start month")
	}
}

func TestValidateHubUserFixtureRejectsInvalidLanguageTag(t *testing.T) {
	user := validFixtureUser()
	user.Languages[0].LanguageTag = "not-a-tag"
	if err := validateHubUserFixture(user); err == nil {
		t.Fatal("expected an error for an unknown language tag")
	}
}

func TestValidateHubProfileFixtureRejectsDuplicateEmail(t *testing.T) {
	fixture := hubProfileFixtureFile{
		Users: []hubUserFixture{validFixtureUser(), validFixtureUser()},
	}
	err := validateHubProfileFixture(fixture)
	if err == nil || !strings.Contains(err.Error(), "duplicate email") {
		t.Fatalf("expected a duplicate email error, got %v", err)
	}
}

// repoRoot locates the repository root from this package's directory, so the
// checked-in dev/hub-seed-profiles fixtures can be loaded the same way
// runHubProfileSeed does.
func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatalf("resolve repository root: %v", err)
	}
	return root
}

// TestTenantFixturesAreValid guards the hand-edited fixture files under
// dev/hub-seed-profiles/ against the same contract validators the Hub API
// enforces, and against picture references that do not exist alongside them,
// so a bad edit fails `go test` instead of `make dev-seed`.
func TestTenantFixturesAreValid(t *testing.T) {
	root := repoRoot(t)
	avatarDir := filepath.Join(root, "dev", "hub-seed-profiles")
	usedAvatars := make(map[string]string)

	for _, tenant := range []string{"sgp", "usa1", "deu", "ind1"} {
		t.Run(tenant, func(t *testing.T) {
			path := filepath.Join(
				root, "dev", "hub-seed-profiles", tenant+".json",
			)
			fixture, err := loadHubProfileFixture(path)
			if err != nil {
				t.Fatalf("load %s: %v", path, err)
			}
			if len(fixture.Users) == 0 {
				t.Fatalf("%s defines no users", path)
			}
			domain := "@" + tenant + ".example"
			for _, user := range fixture.Users {
				if !strings.HasSuffix(user.Email, domain) {
					t.Errorf(
						"user %q is not on the tenant's %s domain",
						user.Email, domain,
					)
				}
				if user.ProfilePicture == "" {
					continue
				}
				if _, err := os.Stat(
					filepath.Join(avatarDir, user.ProfilePicture),
				); err != nil {
					t.Errorf(
						"user %q references missing avatar %q",
						user.Email, user.ProfilePicture,
					)
				}
				if owner, taken := usedAvatars[user.ProfilePicture]; taken {
					t.Errorf(
						"avatar %q is used by both %q and %q",
						user.ProfilePicture, owner, user.Email,
					)
				}
				usedAvatars[user.ProfilePicture] = user.Email
			}
		})
	}
}

func TestValidateHubUserFixtureRejectsBadWebsites(t *testing.T) {
	tooMany := make([]string, 0, 11)
	for i := range 11 {
		tooMany = append(tooMany, fmt.Sprintf("https://site-%d.example.com", i))
	}
	for name, websites := range map[string][]string{
		"not normalized": {"https://GitHub.com/alice/"},
		"not https":      {"http://example.com"},
		"credentials":    {"https://user:pass@example.com"},
		"duplicate":      {"https://example.com", "https://example.com"},
		"over the limit": tooMany,
		"blank":          {""},
	} {
		user := validFixtureUser()
		user.Websites = websites
		if err := validateHubUserFixture(user); err == nil {
			t.Errorf("%s: expected an error for websites %v", name, websites)
		}
	}
}
