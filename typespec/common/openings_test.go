package common

import (
	"reflect"
	"strings"
	"testing"
)

func ptr[T any](value T) *T { return &value }

func validOpening() OpeningContent {
	return OpeningContent{Title: ptr("Engineer"), Description: ptr("Build things"), Language: ptr(LanguageTag("en")), EmployingCountry: ptr(CountryCode("IN")), WorkArrangement: ptr(OpeningOnSite), EmploymentType: ptr(OpeningFullTime), Positions: ptr(int32(1))}
}

func TestOpeningContentValidation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, field string
		change      func(*OpeningContent)
	}{
		{"empty title", "title", func(c *OpeningContent) { c.Title = ptr("") }},
		{"title too long", "title", func(c *OpeningContent) { c.Title = ptr(strings.Repeat("界", 201)) }},
		{"empty description", "description", func(c *OpeningContent) { c.Description = ptr("") }},
		{"description too long", "description", func(c *OpeningContent) { c.Description = ptr(strings.Repeat("界", 20001)) }},
		{"unknown language", "language", func(c *OpeningContent) { c.Language = ptr(LanguageTag("en-US")) }},
		{"unknown country", "employing_country", func(c *OpeningContent) { c.EmployingCountry = ptr(CountryCode("ZZ")) }},
		{"unknown arrangement", "work_arrangement", func(c *OpeningContent) { c.WorkArrangement = ptr(OpeningWorkArrangement("virtual")) }},
		{"location too long", "location_details", func(c *OpeningContent) { c.LocationDetails = ptr(strings.Repeat("界", 2001)) }},
		{"wrong remote placement", "remote_eligibility", func(c *OpeningContent) { c.RemoteEligibility = &OpeningRemoteEligibility{Kind: OpeningWorldwide} }},
		{"missing remote", "remote_eligibility", func(c *OpeningContent) { c.WorkArrangement = ptr(OpeningRemote) }},
		{"unknown remote kind", "remote_eligibility.kind", func(c *OpeningContent) {
			c.WorkArrangement = ptr(OpeningRemote)
			c.RemoteEligibility = &OpeningRemoteEligibility{Kind: "unknown"}
		}},
		{"worldwide list", "remote_eligibility.countries", func(c *OpeningContent) {
			c.WorkArrangement = ptr(OpeningRemote)
			c.RemoteEligibility = &OpeningRemoteEligibility{Kind: OpeningWorldwide, Countries: []CountryCode{}}
		}},
		{"countries empty", "remote_eligibility.countries", func(c *OpeningContent) {
			c.WorkArrangement = ptr(OpeningRemote)
			c.RemoteEligibility = &OpeningRemoteEligibility{Kind: OpeningCountries}
		}},
		{"countries duplicate", "remote_eligibility.countries.1", func(c *OpeningContent) {
			c.WorkArrangement = ptr(OpeningRemote)
			c.RemoteEligibility = &OpeningRemoteEligibility{Kind: OpeningCountries, Countries: []CountryCode{"IN", "IN"}}
		}},
		{"countries invalid", "remote_eligibility.countries.1", func(c *OpeningContent) {
			c.WorkArrangement = ptr(OpeningRemote)
			c.RemoteEligibility = &OpeningRemoteEligibility{Kind: OpeningCountries, Countries: []CountryCode{"IN", "ZZ"}}
		}},
		{"employing country omitted", "remote_eligibility.countries", func(c *OpeningContent) {
			c.WorkArrangement = ptr(OpeningRemote)
			c.RemoteEligibility = &OpeningRemoteEligibility{Kind: OpeningCountries, Countries: []CountryCode{"US"}}
		}},
		{"unknown employment", "employment_type", func(c *OpeningContent) { c.EmploymentType = ptr(OpeningEmploymentType("gig")) }},
		{"positions below", "positions", func(c *OpeningContent) { c.Positions = ptr(int32(0)) }},
		{"positions above", "positions", func(c *OpeningContent) { c.Positions = ptr(int32(11)) }},
		{"experience min below", "experience_years.min", func(c *OpeningContent) { c.ExperienceYears = &OpeningExperienceYears{Min: ptr(int32(-1))} }},
		{"experience min above", "experience_years.min", func(c *OpeningContent) { c.ExperienceYears = &OpeningExperienceYears{Min: ptr(int32(51))} }},
		{"experience max below", "experience_years.max", func(c *OpeningContent) { c.ExperienceYears = &OpeningExperienceYears{Max: ptr(int32(-1))} }},
		{"experience max above", "experience_years.max", func(c *OpeningContent) { c.ExperienceYears = &OpeningExperienceYears{Max: ptr(int32(51))} }},
		{"experience reversed", "experience_years.max", func(c *OpeningContent) {
			c.ExperienceYears = &OpeningExperienceYears{Min: ptr(int32(2)), Max: ptr(int32(1))}
		}},
		{"unknown education", "minimum_education", func(c *OpeningContent) { c.MinimumEducation = ptr(OpeningEducation("other")) }},
		{"currency invalid", "salary.currency", func(c *OpeningContent) {
			c.Salary = &OpeningSalary{Currency: "ZZZ", Min: 0, Max: 1, Period: OpeningYear}
		}},
		{"salary min negative", "salary.min", func(c *OpeningContent) {
			c.Salary = &OpeningSalary{Currency: "USD", Min: -1, Max: 1, Period: OpeningYear}
		}},
		{"salary reversed", "salary.min", func(c *OpeningContent) {
			c.Salary = &OpeningSalary{Currency: "USD", Min: 2, Max: 1, Period: OpeningYear}
		}},
		{"salary max zero", "salary.max", func(c *OpeningContent) {
			c.Salary = &OpeningSalary{Currency: "USD", Min: 0, Max: 0, Period: OpeningYear}
		}},
		{"salary max above cap", "salary.max", func(c *OpeningContent) {
			c.Salary = &OpeningSalary{Currency: "USD", Min: 0, Max: MaxOpeningSalary + 1, Period: OpeningYear}
		}},
		{"salary period invalid", "salary.period", func(c *OpeningContent) { c.Salary = &OpeningSalary{Currency: "USD", Min: 0, Max: 1, Period: "week"} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := validOpening()
			tc.change(&c)
			var fields []string
			if tc.name == "missing remote" {
				fields = MissingForPublication(c)
			} else {
				fields = c.Validate()
			}
			if !contains(fields, tc.field) {
				t.Fatalf("fields = %v, want %s", fields, tc.field)
			}
		})
	}
}

func contains(fields []string, field string) bool {
	for _, value := range fields {
		if value == field {
			return true
		}
	}
	return false
}

func TestOpeningBoundariesAndPublication(t *testing.T) {
	t.Parallel()
	c := validOpening()
	c.Title = ptr(strings.Repeat("界", 200))
	c.Description = ptr(strings.Repeat("界", 20000))
	c.LocationDetails = ptr(strings.Repeat("界", 2000))
	c.Positions = ptr(int32(10))
	c.ExperienceYears = &OpeningExperienceYears{Min: ptr(int32(0)), Max: ptr(int32(50))}
	c.Salary = &OpeningSalary{Currency: "USD", Min: 0, Max: 1, Period: OpeningYear}
	if fields := MissingForPublication(c); len(fields) != 0 {
		t.Fatal(fields)
	}
	if fields := MissingForPublication(OpeningContent{}); !reflect.DeepEqual(fields, []string{"title", "description", "language", "employing_country", "work_arrangement", "employment_type", "positions"}) {
		t.Fatal(fields)
	}
}

func TestOpeningNormalizationDoesNotMutateSource(t *testing.T) {
	t.Parallel()
	original := validOpening()
	original.Title = ptr("  Engineer  ")
	original.Description = ptr("  text  ")
	original.Language = ptr(LanguageTag(" en "))
	original.EmployingCountry = ptr(CountryCode(" in "))
	original.LocationDetails = ptr("  city  ")
	original.WorkArrangement = ptr(OpeningRemote)
	original.RemoteEligibility = &OpeningRemoteEligibility{Kind: OpeningCountries, Countries: []CountryCode{" in ", " IN "}}
	original.Salary = &OpeningSalary{Currency: " usd ", Min: 0, Max: 1, Period: OpeningYear}
	copy := original
	copy.Normalize()
	if *original.Title != "  Engineer  " || original.RemoteEligibility.Countries[0] != " in " || original.Salary.Currency != " usd " {
		t.Fatal("source mutated")
	}
	if *copy.Title != "Engineer" || *copy.Description != "text" || *copy.Language != "en" || *copy.EmployingCountry != "IN" || *copy.LocationDetails != "city" || copy.RemoteEligibility.Countries[0] != "IN" || copy.Salary.Currency != "USD" {
		t.Fatalf("normalized = %+v", copy)
	}
	if !contains(copy.Validate(), "remote_eligibility.countries.1") {
		t.Fatal("duplicate silently dropped")
	}
}

func TestOpeningNormalizationKeepsExplicitEmptyCountries(t *testing.T) {
	t.Parallel()
	c := validOpening()
	c.WorkArrangement = ptr(OpeningRemote)
	c.RemoteEligibility = &OpeningRemoteEligibility{Kind: OpeningWorldwide, Countries: []CountryCode{}}
	c.Normalize()
	if !contains(c.Validate(), "remote_eligibility.countries") {
		t.Fatal("explicit empty list was accepted after normalization")
	}
}

func TestOpeningSalaryAcceptsTheCap(t *testing.T) {
	t.Parallel()
	c := validOpening()
	c.Salary = &OpeningSalary{Currency: "USD", Min: MaxOpeningSalary, Max: MaxOpeningSalary, Period: OpeningYear}
	if fields := c.Validate(); len(fields) != 0 {
		t.Fatal(fields)
	}
}
