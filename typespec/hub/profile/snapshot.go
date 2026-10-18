package profile

import (
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
)

const (
	maxSnapshotBiography       = 2000
	maxSnapshotWorkExperiences = 50
	maxSnapshotCertifications  = 50
	maxSnapshotLanguages       = 75
	maxSnapshotEducation       = 30
)

// ApplicantSnapshot is the public profile as of the application, without the
// picture.
type ApplicantSnapshot struct {
	DisplayName               common.DisplayName         `json:"display_name"`
	Handle                    hub.HubHandle              `json:"handle"`
	ProfileAlias              *directory.HubAlias        `json:"profile_alias,omitempty"`
	ResidentCountry           common.CountryCode         `json:"resident_country"`
	Biography                 *ProfileLongText           `json:"biography,omitempty"`
	Websites                  []Website                  `json:"websites"`
	WorkExperiences           []WorkExperience           `json:"work_experiences"`
	Certifications            []Certification            `json:"certifications"`
	LanguageAbilities         []LanguageAbilityEntry     `json:"language_abilities"`
	EducationalQualifications []EducationalQualification `json:"educational_qualifications"`
}

// Normalized returns a copy whose required arrays are empty rather than nil,
// so they encode as [] and never null.
func (s ApplicantSnapshot) Normalized() ApplicantSnapshot {
	if s.Websites == nil {
		s.Websites = []Website{}
	}
	if s.WorkExperiences == nil {
		s.WorkExperiences = []WorkExperience{}
	}
	if s.Certifications == nil {
		s.Certifications = []Certification{}
	}
	if s.LanguageAbilities == nil {
		s.LanguageAbilities = []LanguageAbilityEntry{}
	}
	if s.EducationalQualifications == nil {
		s.EducationalQualifications = []EducationalQualification{}
	}
	return s
}

// Validate reports the invalid top-level fields. Entry contents were
// validated when the profile stored them; here only the bounds a snapshot
// must keep are checked.
func (s ApplicantSnapshot) Validate() []string {
	fields := []string{}
	if !common.IsDisplayName(s.DisplayName) {
		fields = append(fields, "display_name")
	}
	if !hub.IsHubHandle(s.Handle) {
		fields = append(fields, "handle")
	}
	if s.ProfileAlias != nil && !directory.IsHubAlias(*s.ProfileAlias) {
		fields = append(fields, "profile_alias")
	}
	if !common.IsCountryCode(s.ResidentCountry) {
		fields = append(fields, "resident_country")
	}
	if s.Biography != nil && utf8.RuneCountInString(string(*s.Biography)) > maxSnapshotBiography {
		fields = append(fields, "biography")
	}
	if len(s.Websites) > MaxWebsites {
		fields = append(fields, "websites")
	}
	if len(s.WorkExperiences) > maxSnapshotWorkExperiences {
		fields = append(fields, "work_experiences")
	}
	if len(s.Certifications) > maxSnapshotCertifications {
		fields = append(fields, "certifications")
	}
	if len(s.LanguageAbilities) > maxSnapshotLanguages {
		fields = append(fields, "language_abilities")
	}
	if len(s.EducationalQualifications) > maxSnapshotEducation {
		fields = append(fields, "educational_qualifications")
	}
	return fields
}
