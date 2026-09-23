package profile

import (
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
)

type ProfileAddress string
type ProfileEntryID string
type ProfileMonth string
type ProfileTitle string
type ProfileLongText string
type ProfileLocation string
type EducationSupportingText string
type CredentialURL string
type LanguageTag string
type LanguageAbility string

const (
	Speaking LanguageAbility = "speaking"
	Reading  LanguageAbility = "reading"
	Writing  LanguageAbility = "writing"
)

var profileEntryIDPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-` +
		`[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
)

func IsProfileAddress(value ProfileAddress) bool {
	return directory.IsProfileSlug(string(value))
}

func IsProfileEntryID(value ProfileEntryID) bool {
	return profileEntryIDPattern.MatchString(string(value))
}

func IsProfileMonth(value ProfileMonth) bool {
	text := string(value)
	parsed, err := time.Parse("2006-01", text)
	if err != nil || parsed.Format("2006-01") != text ||
		parsed.Year() < 1900 {
		return false
	}
	now := time.Now().UTC()
	return !parsed.After(time.Date(
		now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC,
	))
}

func IsProfileTitle(value ProfileTitle) bool {
	length := utf8.RuneCountInString(strings.TrimSpace(string(value)))
	return length >= 1 && length <= 200
}

func IsCredentialURL(value CredentialURL) bool {
	text := string(value)
	if len(text) == 0 || len(text) > 2048 ||
		strings.TrimSpace(text) != text || strings.Contains(text, "#") {
		return false
	}
	for _, b := range []byte(text) {
		if b > 127 || b < 32 {
			return false
		}
	}
	u, err := url.Parse(text)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" &&
		u.User == nil && u.Opaque == ""
}

func IsLanguageAbility(value LanguageAbility) bool {
	return value == Speaking || value == Reading || value == Writing
}

func IsLanguageTag(value LanguageTag) bool {
	_, ok := languageCatalogSet[value]
	return ok
}

type WorkExperience struct {
	ID             ProfileEntryID            `json:"id"`
	EmployerDomain common.ProfessionalDomain `json:"employer_domain"`
	JobTitle       ProfileTitle              `json:"job_title"`
	StartMonth     ProfileMonth              `json:"start_month"`
	EndMonth       *ProfileMonth             `json:"end_month,omitempty"`
	Location       *ProfileLocation          `json:"location,omitempty"`
	Description    *ProfileLongText          `json:"description,omitempty"`
}

type Certification struct {
	ID            ProfileEntryID `json:"id"`
	Title         ProfileTitle   `json:"title"`
	CredentialURL CredentialURL  `json:"credential_url"`
}

type LanguageAbilityEntry struct {
	Ability     LanguageAbility `json:"ability"`
	LanguageTag LanguageTag     `json:"language_tag"`
}

type EducationalQualification struct {
	ID                ProfileEntryID            `json:"id"`
	InstitutionDomain common.ProfessionalDomain `json:"institution_domain"`
	Degree            ProfileTitle              `json:"degree"`
	Title             *ProfileTitle             `json:"title,omitempty"`
	SupportingText    *EducationSupportingText  `json:"supporting_text,omitempty"`
	StartMonth        *ProfileMonth             `json:"start_month,omitempty"`
	EndMonth          *ProfileMonth             `json:"end_month,omitempty"`
}

type PublicProfile struct {
	DisplayName               common.DisplayName         `json:"display_name"`
	Handle                    hub.HubHandle              `json:"handle"`
	ProfileAlias              *directory.HubAlias        `json:"profile_alias,omitempty"`
	ResidentCountry           common.CountryCode         `json:"resident_country"`
	ProfilePictureURL         *string                    `json:"profile_picture_url,omitempty"`
	Biography                 *ProfileLongText           `json:"biography,omitempty"`
	WorkExperiences           []WorkExperience           `json:"work_experiences"`
	Certifications            []Certification            `json:"certifications"`
	LanguageAbilities         []LanguageAbilityEntry     `json:"language_abilities"`
	EducationalQualifications []EducationalQualification `json:"educational_qualifications"`
}

type ReadProfileRequest struct {
	Address ProfileAddress `json:"address"`
}

func (r *ReadProfileRequest) Normalize() {
	r.Address = ProfileAddress(strings.TrimSpace(string(r.Address)))
}

func (r ReadProfileRequest) Validate() []string {
	if !IsProfileAddress(r.Address) {
		return []string{"address"}
	}
	return []string{}
}

type SetPublicFieldsRequest struct {
	DisplayName common.DisplayName `json:"display_name"`
	Biography   *ProfileLongText   `json:"biography,omitempty"`
}

func (r *SetPublicFieldsRequest) Normalize() {
	r.DisplayName = common.NormalizeDisplayName(r.DisplayName)
	if r.Biography != nil {
		trimmed := ProfileLongText(strings.TrimSpace(string(*r.Biography)))
		if trimmed == "" {
			r.Biography = nil
		} else {
			r.Biography = &trimmed
		}
	}
}

func (r SetPublicFieldsRequest) Validate() []string {
	fields := []string{}
	if !common.IsDisplayName(r.DisplayName) {
		fields = append(fields, "display_name")
	}
	if r.Biography != nil && utf8.RuneCountInString(string(*r.Biography)) > 2000 {
		fields = append(fields, "biography")
	}
	return fields
}

type SaveWorkExperienceRequest struct {
	ID             *ProfileEntryID           `json:"id,omitempty"`
	EmployerDomain common.ProfessionalDomain `json:"employer_domain"`
	JobTitle       ProfileTitle              `json:"job_title"`
	StartMonth     ProfileMonth              `json:"start_month"`
	EndMonth       *ProfileMonth             `json:"end_month,omitempty"`
	Location       *ProfileLocation          `json:"location,omitempty"`
	Description    *ProfileLongText          `json:"description,omitempty"`
}

func (r *SaveWorkExperienceRequest) Normalize() {
	r.EmployerDomain = common.NormalizeProfessionalDomain(r.EmployerDomain)
	r.JobTitle = ProfileTitle(strings.TrimSpace(string(r.JobTitle)))
	if r.Location != nil {
		trimmed := ProfileLocation(strings.TrimSpace(string(*r.Location)))
		r.Location = &trimmed
	}
	if r.Description != nil {
		trimmed := ProfileLongText(strings.TrimSpace(string(*r.Description)))
		r.Description = &trimmed
	}
}

func (r SaveWorkExperienceRequest) Validate() []string {
	fields := []string{}
	if r.ID != nil && !IsProfileEntryID(*r.ID) {
		fields = append(fields, "id")
	}
	if !common.IsProfessionalDomain(r.EmployerDomain) {
		fields = append(fields, "employer_domain")
	}
	if !IsProfileTitle(r.JobTitle) {
		fields = append(fields, "job_title")
	}
	if !IsProfileMonth(r.StartMonth) {
		fields = append(fields, "start_month")
	}
	if r.EndMonth != nil &&
		(!IsProfileMonth(*r.EndMonth) || *r.EndMonth < r.StartMonth) {
		fields = append(fields, "end_month")
	}
	if r.Location != nil && utf8.RuneCountInString(string(*r.Location)) > 200 {
		fields = append(fields, "location")
	}
	if r.Description != nil &&
		utf8.RuneCountInString(string(*r.Description)) > 2000 {
		fields = append(fields, "description")
	}
	return fields
}

type SaveCertificationRequest struct {
	ID            *ProfileEntryID `json:"id,omitempty"`
	Title         ProfileTitle    `json:"title"`
	CredentialURL CredentialURL   `json:"credential_url"`
}

func (r *SaveCertificationRequest) Normalize() {
	r.Title = ProfileTitle(strings.TrimSpace(string(r.Title)))
	r.CredentialURL = CredentialURL(strings.TrimSpace(string(r.CredentialURL)))
}

func (r SaveCertificationRequest) Validate() []string {
	fields := []string{}
	if r.ID != nil && !IsProfileEntryID(*r.ID) {
		fields = append(fields, "id")
	}
	if !IsProfileTitle(r.Title) {
		fields = append(fields, "title")
	}
	if !IsCredentialURL(r.CredentialURL) {
		fields = append(fields, "credential_url")
	}
	return fields
}

type SaveEducationalQualificationRequest struct {
	ID                *ProfileEntryID           `json:"id,omitempty"`
	InstitutionDomain common.ProfessionalDomain `json:"institution_domain"`
	Degree            ProfileTitle              `json:"degree"`
	Title             *ProfileTitle             `json:"title,omitempty"`
	SupportingText    *EducationSupportingText  `json:"supporting_text,omitempty"`
	StartMonth        *ProfileMonth             `json:"start_month,omitempty"`
	EndMonth          *ProfileMonth             `json:"end_month,omitempty"`
}

func (r *SaveEducationalQualificationRequest) Normalize() {
	r.InstitutionDomain = common.NormalizeProfessionalDomain(
		r.InstitutionDomain,
	)
	r.Degree = ProfileTitle(strings.TrimSpace(string(r.Degree)))
	if r.Title != nil {
		trimmed := ProfileTitle(strings.TrimSpace(string(*r.Title)))
		r.Title = &trimmed
	}
	if r.SupportingText != nil {
		trimmed := EducationSupportingText(strings.TrimSpace(
			string(*r.SupportingText),
		))
		r.SupportingText = &trimmed
	}
}

func (r SaveEducationalQualificationRequest) Validate() []string {
	fields := []string{}
	if r.ID != nil && !IsProfileEntryID(*r.ID) {
		fields = append(fields, "id")
	}
	if !common.IsProfessionalDomain(r.InstitutionDomain) {
		fields = append(fields, "institution_domain")
	}
	if !IsProfileTitle(r.Degree) {
		fields = append(fields, "degree")
	}
	if r.Title != nil && !IsProfileTitle(*r.Title) {
		fields = append(fields, "title")
	}
	if r.SupportingText != nil &&
		utf8.RuneCountInString(string(*r.SupportingText)) > 249 {
		fields = append(fields, "supporting_text")
	}
	if r.StartMonth != nil && !IsProfileMonth(*r.StartMonth) {
		fields = append(fields, "start_month")
	}
	if r.EndMonth != nil && (!IsProfileMonth(*r.EndMonth) ||
		(r.StartMonth != nil && *r.EndMonth < *r.StartMonth)) {
		fields = append(fields, "end_month")
	}
	return fields
}

type DeleteProfileEntryRequest struct {
	ID ProfileEntryID `json:"id"`
}

func (r *DeleteProfileEntryRequest) Normalize() {}

func (r DeleteProfileEntryRequest) Validate() []string {
	if !IsProfileEntryID(r.ID) {
		return []string{"id"}
	}
	return []string{}
}

type ChangeLanguageAbilityRequest struct {
	Ability     LanguageAbility `json:"ability"`
	LanguageTag LanguageTag     `json:"language_tag"`
}

func (r *ChangeLanguageAbilityRequest) Normalize() {}

func (r ChangeLanguageAbilityRequest) Validate() []string {
	fields := []string{}
	if !IsLanguageAbility(r.Ability) {
		fields = append(fields, "ability")
	}
	if !IsLanguageTag(r.LanguageTag) {
		fields = append(fields, "language_tag")
	}
	return fields
}
