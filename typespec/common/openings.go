package common

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

type OpeningWorkArrangement string
type OpeningEmploymentType string
type OpeningEducation string
type OpeningSalaryPeriod string
type OpeningRemoteEligibilityKind string

const (
	OpeningOnSite     OpeningWorkArrangement       = "on_site"
	OpeningHybrid     OpeningWorkArrangement       = "hybrid"
	OpeningRemote     OpeningWorkArrangement       = "remote"
	OpeningFullTime   OpeningEmploymentType        = "full_time"
	OpeningPartTime   OpeningEmploymentType        = "part_time"
	OpeningContract   OpeningEmploymentType        = "contract"
	OpeningInternship OpeningEmploymentType        = "internship"
	OpeningSecondary  OpeningEducation             = "secondary"
	OpeningBachelor   OpeningEducation             = "bachelor"
	OpeningMaster     OpeningEducation             = "master"
	OpeningDoctorate  OpeningEducation             = "doctorate"
	OpeningHour       OpeningSalaryPeriod          = "hour"
	OpeningDay        OpeningSalaryPeriod          = "day"
	OpeningMonth      OpeningSalaryPeriod          = "month"
	OpeningYear       OpeningSalaryPeriod          = "year"
	OpeningWorldwide  OpeningRemoteEligibilityKind = "worldwide"
	OpeningCountries  OpeningRemoteEligibilityKind = "countries"
)

type OpeningRemoteEligibility struct {
	Kind      OpeningRemoteEligibilityKind `json:"kind"`
	Countries []CountryCode                `json:"countries,omitempty"`
}

type OpeningExperienceYears struct {
	Min *int32 `json:"min,omitempty"`
	Max *int32 `json:"max,omitempty"`
}

// MaxOpeningSalary keeps every salary exact as a JavaScript number.
const MaxOpeningSalary = 1_000_000_000_000

type OpeningSalary struct {
	Currency CurrencyCode        `json:"currency"`
	Min      int64               `json:"min"`
	Max      int64               `json:"max"`
	Period   OpeningSalaryPeriod `json:"period"`
}

type ApplicationQuestionType string

const (
	QuestionShortText      ApplicationQuestionType = "short_text"
	QuestionLongText       ApplicationQuestionType = "long_text"
	QuestionNumber         ApplicationQuestionType = "number"
	QuestionYesNo          ApplicationQuestionType = "yes_no"
	QuestionSingleChoice   ApplicationQuestionType = "single_choice"
	QuestionMultipleChoice ApplicationQuestionType = "multiple_choice"
)

const (
	MaxApplicationQuestions = 10
	MaxQuestionOptions      = 8
	MaxQuestionNumber       = 1_000_000_000
	maxQuestionText         = 500
	maxQuestionOption       = 200
)

type ApplicationQuestionID string

var questionIDPattern = regexp.MustCompile(
	`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
)

// IsApplicationQuestionID accepts the lowercase form the API returns.
func IsApplicationQuestionID(value ApplicationQuestionID) bool {
	return questionIDPattern.MatchString(string(value))
}

func IsApplicationQuestionType(value ApplicationQuestionType) bool {
	switch value {
	case QuestionShortText, QuestionLongText, QuestionNumber, QuestionYesNo,
		QuestionSingleChoice, QuestionMultipleChoice:
		return true
	}
	return false
}

// IsChoiceQuestion reports the types whose answers come from options.
func IsChoiceQuestion(value ApplicationQuestionType) bool {
	return value == QuestionSingleChoice || value == QuestionMultipleChoice
}

type ApplicationQuestion struct {
	ID       *ApplicationQuestionID  `json:"id,omitempty"`
	Text     string                  `json:"text"`
	Type     ApplicationQuestionType `json:"type"`
	Required bool                    `json:"required"`
	Min      *int64                  `json:"min,omitempty"`
	Max      *int64                  `json:"max,omitempty"`
	Options  []string                `json:"options,omitempty"`
}

type OpeningContent struct {
	Title             *string                   `json:"title,omitempty"`
	Description       *string                   `json:"description,omitempty"`
	Language          *LanguageTag              `json:"language,omitempty"`
	EmployingCountry  *CountryCode              `json:"employing_country,omitempty"`
	WorkArrangement   *OpeningWorkArrangement   `json:"work_arrangement,omitempty"`
	LocationDetails   *string                   `json:"location_details,omitempty"`
	RemoteEligibility *OpeningRemoteEligibility `json:"remote_eligibility,omitempty"`
	EmploymentType    *OpeningEmploymentType    `json:"employment_type,omitempty"`
	Positions         *int32                    `json:"positions,omitempty"`
	ExperienceYears   *OpeningExperienceYears   `json:"experience_years,omitempty"`
	MinimumEducation  *OpeningEducation         `json:"minimum_education,omitempty"`
	Salary            *OpeningSalary            `json:"salary,omitempty"`
	Questions         []ApplicationQuestion     `json:"questions,omitempty"`
}

// Normalize replaces nested pointer values so a shallow copy does not alter its source.
func (c *OpeningContent) Normalize() {
	if c.Title != nil {
		value := strings.TrimSpace(*c.Title)
		c.Title = &value
	}
	if c.Description != nil {
		value := strings.TrimSpace(*c.Description)
		c.Description = &value
	}
	if c.Language != nil {
		value := LanguageTag(strings.TrimSpace(string(*c.Language)))
		c.Language = &value
	}
	if c.EmployingCountry != nil {
		value := CountryCode(strings.ToUpper(strings.TrimSpace(string(*c.EmployingCountry))))
		c.EmployingCountry = &value
	}
	if c.LocationDetails != nil {
		value := strings.TrimSpace(*c.LocationDetails)
		c.LocationDetails = &value
	}
	if c.RemoteEligibility != nil {
		value := *c.RemoteEligibility
		if value.Countries != nil {
			value.Countries = append([]CountryCode{}, value.Countries...)
		}
		for i, country := range value.Countries {
			value.Countries[i] = CountryCode(strings.ToUpper(strings.TrimSpace(string(country))))
		}
		c.RemoteEligibility = &value
	}
	if c.Salary != nil {
		value := *c.Salary
		value.Currency = CurrencyCode(strings.ToUpper(strings.TrimSpace(string(value.Currency))))
		c.Salary = &value
	}
	if c.Questions != nil {
		questions := make([]ApplicationQuestion, len(c.Questions))
		for i, question := range c.Questions {
			question.Text = strings.TrimSpace(question.Text)
			if question.Options != nil {
				options := make([]string, len(question.Options))
				for j, option := range question.Options {
					options[j] = strings.TrimSpace(option)
				}
				question.Options = options
			}
			questions[i] = question
		}
		c.Questions = questions
	}
}

func openingTextValid(value string, max int) bool {
	length := utf8.RuneCountInString(value)
	return length >= 1 && length <= max
}

func (c OpeningContent) Validate() []string {
	var fields []string
	if c.Title != nil && !openingTextValid(*c.Title, 200) {
		fields = append(fields, "title")
	}
	if c.Description != nil && !openingTextValid(*c.Description, 20000) {
		fields = append(fields, "description")
	}
	if c.Language != nil && !IsLanguageTag(*c.Language) {
		fields = append(fields, "language")
	}
	if c.EmployingCountry != nil && !IsCountryCode(*c.EmployingCountry) {
		fields = append(fields, "employing_country")
	}
	if c.WorkArrangement != nil && *c.WorkArrangement != OpeningOnSite && *c.WorkArrangement != OpeningHybrid && *c.WorkArrangement != OpeningRemote {
		fields = append(fields, "work_arrangement")
	}
	if c.LocationDetails != nil && utf8.RuneCountInString(*c.LocationDetails) > 2000 {
		fields = append(fields, "location_details")
	}
	if c.RemoteEligibility != nil {
		r := c.RemoteEligibility
		if c.WorkArrangement == nil || *c.WorkArrangement != OpeningRemote {
			fields = append(fields, "remote_eligibility")
		}
		if r.Kind != OpeningWorldwide && r.Kind != OpeningCountries {
			fields = append(fields, "remote_eligibility.kind")
		}
		if r.Kind == OpeningWorldwide && r.Countries != nil {
			fields = append(fields, "remote_eligibility.countries")
		}
		if r.Kind == OpeningCountries {
			if len(r.Countries) == 0 {
				fields = append(fields, "remote_eligibility.countries")
			}
			seen := map[CountryCode]bool{}
			for i, country := range r.Countries {
				if !IsCountryCode(country) || seen[country] {
					fields = append(fields, fmt.Sprintf("remote_eligibility.countries.%d", i))
				}
				seen[country] = true
			}
			if c.EmployingCountry != nil && IsCountryCode(*c.EmployingCountry) && !seen[*c.EmployingCountry] {
				fields = append(fields, "remote_eligibility.countries")
			}
		}
	}
	if c.EmploymentType != nil && *c.EmploymentType != OpeningFullTime && *c.EmploymentType != OpeningPartTime && *c.EmploymentType != OpeningContract && *c.EmploymentType != OpeningInternship {
		fields = append(fields, "employment_type")
	}
	if c.Positions != nil && (*c.Positions < 1 || *c.Positions > 10) {
		fields = append(fields, "positions")
	}
	if c.ExperienceYears != nil {
		e := c.ExperienceYears
		if e.Min != nil && (*e.Min < 0 || *e.Min > 50) {
			fields = append(fields, "experience_years.min")
		}
		if e.Max != nil && (*e.Max < 0 || *e.Max > 50 || (e.Min != nil && *e.Min > *e.Max)) {
			fields = append(fields, "experience_years.max")
		}
	}
	if c.MinimumEducation != nil && *c.MinimumEducation != OpeningSecondary && *c.MinimumEducation != OpeningBachelor && *c.MinimumEducation != OpeningMaster && *c.MinimumEducation != OpeningDoctorate {
		fields = append(fields, "minimum_education")
	}
	if c.Salary != nil {
		s := c.Salary
		if !IsCurrencyCode(s.Currency) {
			fields = append(fields, "salary.currency")
		}
		if s.Min < 0 || s.Min > s.Max {
			fields = append(fields, "salary.min")
		}
		if s.Max < 1 || s.Max > MaxOpeningSalary {
			fields = append(fields, "salary.max")
		}
		if s.Period != OpeningHour && s.Period != OpeningDay && s.Period != OpeningMonth && s.Period != OpeningYear {
			fields = append(fields, "salary.period")
		}
	}
	return append(fields, validateQuestions(c.Questions)...)
}

func validateQuestions(questions []ApplicationQuestion) []string {
	var fields []string
	if len(questions) > MaxApplicationQuestions {
		fields = append(fields, "questions")
	}
	ids := map[ApplicationQuestionID]bool{}
	numberValid := func(value int64) bool { return value >= 0 && value <= MaxQuestionNumber }
	for i, q := range questions {
		path := fmt.Sprintf("questions.%d", i)
		if q.ID != nil {
			if !IsApplicationQuestionID(*q.ID) || ids[*q.ID] {
				fields = append(fields, path+".id")
			}
			ids[*q.ID] = true
		}
		if !openingTextValid(q.Text, maxQuestionText) {
			fields = append(fields, path+".text")
		}
		if !IsApplicationQuestionType(q.Type) {
			fields = append(fields, path+".type")
		}
		number := q.Type == QuestionNumber
		if q.Min != nil && (!number || !numberValid(*q.Min)) {
			fields = append(fields, path+".min")
		}
		if q.Max != nil && (!number || !numberValid(*q.Max) || (q.Min != nil && *q.Min > *q.Max)) {
			fields = append(fields, path+".max")
		}
		choice := IsChoiceQuestion(q.Type)
		if (choice && (len(q.Options) < 2 || len(q.Options) > MaxQuestionOptions)) ||
			(!choice && q.Options != nil) {
			fields = append(fields, path+".options")
		}
		if choice {
			seen := map[string]bool{}
			for j, option := range q.Options {
				key := strings.ToLower(option)
				if !openingTextValid(option, maxQuestionOption) || seen[key] {
					fields = append(fields, fmt.Sprintf("%s.options.%d", path, j))
				}
				seen[key] = true
			}
		}
	}
	return fields
}

func MissingForPublication(c OpeningContent) []string {
	fields := c.Validate()
	present := make(map[string]bool, len(fields))
	for _, field := range fields {
		present[field] = true
	}
	add := func(path string, missing bool) {
		if missing && !present[path] {
			fields = append(fields, path)
			present[path] = true
		}
	}
	add("title", c.Title == nil)
	add("description", c.Description == nil)
	add("language", c.Language == nil)
	add("employing_country", c.EmployingCountry == nil)
	add("work_arrangement", c.WorkArrangement == nil)
	add("employment_type", c.EmploymentType == nil)
	add("positions", c.Positions == nil)
	add("remote_eligibility", c.WorkArrangement != nil && *c.WorkArrangement == OpeningRemote && c.RemoteEligibility == nil)
	return fields
}
