package profile

import (
	"slices"
	"strings"
	"testing"
	"time"
)

func TestProfileAddressAndMonth(t *testing.T) {
	t.Parallel()
	for _, address := range []ProfileAddress{
		"alice", "a-b", "alice-2", "alice000-23456789012",
	} {
		if !IsProfileAddress(address) {
			t.Errorf("valid address %q rejected", address)
		}
	}
	for _, address := range []ProfileAddress{
		"ab", "-alice", "alice-", "alice--2", "Alice", "alice@example",
		"api",
	} {
		if IsProfileAddress(address) {
			t.Errorf("invalid address %q accepted", address)
		}
	}
	for _, month := range []ProfileMonth{"1900-01", "2020-12"} {
		if !IsProfileMonth(month) {
			t.Errorf("valid month %q rejected", month)
		}
	}
	for _, month := range []ProfileMonth{
		"1899-12", "2020-00", "2020-13", "2020-1",
		ProfileMonth(time.Now().UTC().AddDate(1, 0, 0).Format("2006-01")),
	} {
		if IsProfileMonth(month) {
			t.Errorf("invalid month %q accepted", month)
		}
	}
}

func TestProfileRequestNormalizationDoesNotMutateSharedPointers(t *testing.T) {
	t.Parallel()
	originalBiography := ProfileLongText("  first\nsecond  ")
	original := SetPublicFieldsRequest{
		DisplayName: "  Alice  ", Biography: &originalBiography,
	}
	normalized := original
	normalized.Normalize()
	if normalized.DisplayName != "Alice" ||
		*normalized.Biography != "first\nsecond" ||
		*original.Biography != "  first\nsecond  " {
		t.Fatalf("normalization mutated caller storage: %+v %+v", normalized, original)
	}
	if fields := normalized.Validate(); len(fields) != 0 {
		t.Fatalf("valid fields rejected: %v", fields)
	}

	location := ProfileLocation("  London  ")
	work := SaveWorkExperienceRequest{
		EmployerDomain: "  EXAMPLE.COM. ", JobTitle: "  Engineer  ",
		StartMonth: "2020-01", Location: &location,
	}
	copy := work
	copy.Normalize()
	if copy.EmployerDomain != "example.com" || copy.JobTitle != "Engineer" ||
		*copy.Location != "London" || *work.Location != "  London  " {
		t.Fatalf("work normalization mutated caller storage: %+v %+v", copy, work)
	}
}

func TestProfileRequestValidation(t *testing.T) {
	t.Parallel()
	badEnd := ProfileMonth("2019-12")
	tooLong := ProfileLongText(strings.Repeat("界", 2001))
	work := SaveWorkExperienceRequest{
		EmployerDomain: "not-a-domain", JobTitle: " ",
		StartMonth: "2020-01", EndMonth: &badEnd,
		Description: &tooLong,
	}
	if got, want := work.Validate(), []string{
		"employer_domain", "job_title", "end_month", "description",
	}; !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}

	for _, url := range []CredentialURL{
		"https://user:pass@example.com/credential",
		"http://example.com/credential",
		"https://example.com/credential#fragment",
		"https://example.com/ü",
	} {
		if IsCredentialURL(url) {
			t.Errorf("invalid credential URL %q accepted", url)
		}
	}
	if !IsCredentialURL("https://example.com/credential?id=1") {
		t.Fatal("valid credential URL rejected")
	}

	start := ProfileMonth("2020-01")
	education := SaveEducationalQualificationRequest{
		InstitutionDomain: "example.edu", Degree: "BSc",
		StartMonth: &start, EndMonth: &badEnd,
	}
	if got := education.Validate(); !slices.Equal(got, []string{"end_month"}) {
		t.Fatalf("education fields = %v", got)
	}
}

func TestWebsiteURLNormalizationAndValidation(t *testing.T) {
	t.Parallel()
	// The same table is asserted by the TypeScript companion.
	for input, want := range map[WebsiteURL]WebsiteURL{
		"  HTTPS://GitHub.COM/Octocat/  ": "https://github.com/Octocat",
		"https://Example.com/":            "https://example.com",
		"https://example.com/?a=1":        "https://example.com/?a=1",
		"https://EXAMPLE.com:8443/A/b/":   "https://example.com:8443/A/b",
		"https://example.com/a/?next=/":   "https://example.com/a/?next=/",
		"http://Example.com/":             "http://Example.com/",
		"not a url":                       "not a url",
	} {
		if got := NormalizeWebsiteURL(input); got != want {
			t.Errorf("NormalizeWebsiteURL(%q) = %q, want %q", input, got, want)
		}
	}
	for _, valid := range []WebsiteURL{
		"https://github.com/octocat",
		"https://www.linkedin.com/in/some-person-123",
		"https://x.com/handle",
		"https://sub.example.co.uk",
		"https://example.com:8443/path?q=1&r=%C3%BC",
		"https://example.com/?a=1",
		"https://xn--mnchen-3ya.de/stra%C3%9Fe",
		"https://1.2.3.4.example.com/x",
	} {
		if !IsWebsiteURL(valid) {
			t.Errorf("valid website URL %q rejected", valid)
		}
	}
	for _, invalid := range []WebsiteURL{
		"",
		"http://example.com",
		"https://",
		"https://localhost",
		"https://127.0.0.1",
		"https://1.2.3.4:8080/x",
		"https://Example.com",
		"https://user:pass@example.com",
		"https://example.com@evil.example.org",
		"https://example.com#fragment",
		"https://example.com/a#fragment",
		"https://example.com?x=1",
		"https://example.com/",
		"https://example.com/a b",
		"https://example.com/ü",
		"https://münchen.de",
		"https://-bad.example.com",
		"https://bad-.example.com",
		"https://example..com",
		"https://example.com:123456",
		"https://" + WebsiteURL(strings.Repeat("a", 64)) + ".com",
		"https://example.com/" + WebsiteURL(strings.Repeat("a", 2048)),
	} {
		if IsWebsiteURL(invalid) {
			t.Errorf("invalid website URL %q accepted", invalid)
		}
	}
	if !IsWebsiteURL("https://example.com/" + WebsiteURL(strings.Repeat("a", 2028))) {
		t.Error("URL of exactly 2048 characters rejected")
	}

	badID := ProfileEntryID("not-a-uuid")
	original := SaveWebsiteRequest{ID: &badID, URL: " HTTP://Example.com/ "}
	normalized := original
	normalized.Normalize()
	if original.URL != " HTTP://Example.com/ " ||
		normalized.URL != "HTTP://Example.com/" {
		t.Fatalf("normalization = %+v from %+v", normalized, original)
	}
	if got := normalized.Validate(); !slices.Equal(got, []string{"id", "url"}) {
		t.Fatalf("fields = %v", got)
	}
	ok := SaveWebsiteRequest{URL: " https://GitHub.com/octocat/ "}
	ok.Normalize()
	if got := ok.Validate(); len(got) != 0 || ok.URL != "https://github.com/octocat" {
		t.Fatalf("valid request = %+v, fields %v", ok, got)
	}
}

func TestLivingLanguageCatalog(t *testing.T) {
	t.Parallel()
	for _, tag := range []LanguageTag{"en", "ta", "ase"} {
		if !IsLanguageTag(tag) {
			t.Errorf("living language %q rejected", tag)
		}
	}
	for _, tag := range []LanguageTag{
		"eo", "akk", "en-US", "en-Latn", "iw", "x-private",
	} {
		if IsLanguageTag(tag) {
			t.Errorf("unsupported language %q accepted", tag)
		}
	}
	tags := SupportedLanguageTags()
	if len(tags) != 578 {
		t.Fatalf("catalog size = %d, want 578", len(tags))
	}
	tags[0] = "not-a-language"
	if SupportedLanguageTags()[0] == "not-a-language" {
		t.Fatal("catalog caller mutated package state")
	}
}
