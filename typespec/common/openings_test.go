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

func validQuestions() []ApplicationQuestion {
	return []ApplicationQuestion{
		{ID: ptr(ApplicationQuestionID("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")), Text: "Notice period in days", Type: QuestionNumber, Required: true, Min: ptr(int64(0)), Max: ptr(int64(MaxQuestionNumber))},
		{Text: strings.Repeat("界", 500), Type: QuestionShortText},
		{Text: "Why us?", Type: QuestionLongText},
		{Text: "Authorized to work in Germany?", Type: QuestionYesNo, Required: true},
		{Text: "Preferred office", Type: QuestionSingleChoice, Options: []string{"Berlin", "Munich"}},
		{Text: "Languages", Type: QuestionMultipleChoice, Options: []string{"a", "b", "c", "d", "e", "f", "g", strings.Repeat("界", 200)}},
	}
}

func TestApplicationQuestionValidation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, field string
		change      func([]ApplicationQuestion) []ApplicationQuestion
	}{
		{"too many", "questions", func(q []ApplicationQuestion) []ApplicationQuestion { return append(q, q[1], q[2], q[3], q[1], q[2]) }},
		{"malformed id", "questions.0.id", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[0].ID = ptr(ApplicationQuestionID("0190A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B"))
			return q
		}},
		{"duplicate id", "questions.1.id", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[1].ID = q[0].ID
			return q
		}},
		{"empty text", "questions.2.text", func(q []ApplicationQuestion) []ApplicationQuestion { q[2].Text = ""; return q }},
		{"text too long", "questions.2.text", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[2].Text = strings.Repeat("界", 501)
			return q
		}},
		{"unknown type", "questions.2.type", func(q []ApplicationQuestion) []ApplicationQuestion { q[2].Type = "date"; return q }},
		{"min below", "questions.0.min", func(q []ApplicationQuestion) []ApplicationQuestion { q[0].Min = ptr(int64(-1)); return q }},
		{"max above", "questions.0.max", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[0].Max = ptr(int64(MaxQuestionNumber + 1))
			return q
		}},
		{"min above max", "questions.0.max", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[0].Min, q[0].Max = ptr(int64(5)), ptr(int64(4))
			return q
		}},
		{"min on text", "questions.1.min", func(q []ApplicationQuestion) []ApplicationQuestion { q[1].Min = ptr(int64(1)); return q }},
		{"max on choice", "questions.4.max", func(q []ApplicationQuestion) []ApplicationQuestion { q[4].Max = ptr(int64(1)); return q }},
		{"options on number", "questions.0.options", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[0].Options = []string{"a", "b"}
			return q
		}},
		{"options on yes no", "questions.3.options", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[3].Options = []string{}
			return q
		}},
		{"choice without options", "questions.4.options", func(q []ApplicationQuestion) []ApplicationQuestion { q[4].Options = nil; return q }},
		{"one option", "questions.4.options", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[4].Options = []string{"Berlin"}
			return q
		}},
		{"nine options", "questions.5.options", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[5].Options = append(q[5].Options, "i")
			return q
		}},
		{"empty option", "questions.4.options.1", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[4].Options = []string{"Berlin", ""}
			return q
		}},
		{"option too long", "questions.4.options.1", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[4].Options = []string{"Berlin", strings.Repeat("界", 201)}
			return q
		}},
		{"duplicate option ignoring case", "questions.4.options.1", func(q []ApplicationQuestion) []ApplicationQuestion {
			q[4].Options = []string{"Berlin", "BERLIN"}
			return q
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			content := validOpening()
			content.Questions = tc.change(validQuestions())
			if fields := content.Validate(); !reflect.DeepEqual(fields, []string{tc.field}) {
				t.Fatalf("Validate() = %v, want [%s]", fields, tc.field)
			}
		})
	}
}

func TestApplicationQuestionBoundaries(t *testing.T) {
	t.Parallel()
	content := validOpening()
	content.Questions = validQuestions()
	if fields := content.Validate(); len(fields) != 0 {
		t.Fatalf("Validate() = %v, want none", fields)
	}
	if fields := MissingForPublication(content); len(fields) != 0 {
		t.Fatalf("MissingForPublication() = %v, want none", fields)
	}
}

func TestApplicationQuestionNormalizationDoesNotMutateSource(t *testing.T) {
	t.Parallel()
	source := validOpening()
	source.Questions = []ApplicationQuestion{{Text: "  Office  ", Type: QuestionSingleChoice, Options: []string{" Berlin ", "Munich "}}}
	normalized := source
	normalized.Normalize()
	if source.Questions[0].Text != "  Office  " || source.Questions[0].Options[0] != " Berlin " {
		t.Fatalf("source changed: %+v", source.Questions[0])
	}
	want := ApplicationQuestion{Text: "Office", Type: QuestionSingleChoice, Options: []string{"Berlin", "Munich"}}
	if !reflect.DeepEqual(normalized.Questions[0], want) {
		t.Fatalf("normalized = %+v, want %+v", normalized.Questions[0], want)
	}
}
