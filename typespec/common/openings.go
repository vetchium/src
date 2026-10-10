package common

import (
	"fmt"
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

type OpeningSalary struct {
	Currency CurrencyCode        `json:"currency"`
	Min      int64               `json:"min"`
	Max      int64               `json:"max"`
	Period   OpeningSalaryPeriod `json:"period"`
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
		if s.Max < 1 {
			fields = append(fields, "salary.max")
		}
		if s.Period != OpeningHour && s.Period != OpeningDay && s.Period != OpeningMonth && s.Period != OpeningYear {
			fields = append(fields, "salary.period")
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
