package openings

import (
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/hiring"
)

type OpeningTitleQuery string

func normalizeEmail(value *common.EmailAddress) *common.EmailAddress {
	if value == nil {
		return nil
	}
	normalized := common.NormalizeEmailAddress(*value)
	return &normalized
}

func normalizeTeam(values []common.EmailAddress) []common.EmailAddress {
	if values == nil {
		return nil
	}
	normalized := make([]common.EmailAddress, len(values))
	for index, value := range values {
		normalized[index] = common.NormalizeEmailAddress(value)
	}
	return normalized
}

func validTeam(values []common.EmailAddress) bool {
	if values == nil || len(values) > 20 {
		return false
	}
	seen := make(map[common.EmailAddress]bool, len(values))
	for _, value := range values {
		if !common.IsEmailAddress(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

func normalizeNotes(value *string) *string {
	if value == nil {
		return nil
	}
	normalized := strings.TrimSpace(*value)
	return &normalized
}

func validNotes(value *string) bool {
	if value == nil {
		return true
	}
	length := utf8.RuneCountInString(*value)
	return length >= 1 && length <= 2000
}

func validNumber(value OpeningNumber) bool   { return value >= 1 }
func validVersion(value OpeningVersion) bool { return value >= 1 }

func validateTeam(manager, recruiter *common.EmailAddress, members []common.EmailAddress, notes *string) []string {
	fields := []string{}
	if manager != nil && !common.IsEmailAddress(*manager) {
		fields = append(fields, "hiring_manager_email")
	}
	if recruiter != nil && !common.IsEmailAddress(*recruiter) {
		fields = append(fields, "recruiter_email")
	}
	if !validTeam(members) {
		fields = append(fields, "team_member_emails")
	}
	if !validNotes(notes) {
		fields = append(fields, "internal_notes")
	}
	return fields
}

type CreateOpeningRequest struct {
	Content            *common.OpeningContent `json:"content"`
	HiringManagerEmail *common.EmailAddress   `json:"hiring_manager_email,omitempty"`
	RecruiterEmail     *common.EmailAddress   `json:"recruiter_email,omitempty"`
	TeamMemberEmails   []common.EmailAddress  `json:"team_member_emails"`
	InternalNotes      *string                `json:"internal_notes,omitempty"`

	// PipelineTemplateID names the template the new Opening copies; nil gives
	// one review stage.
	PipelineTemplateID *hiring.PipelineTemplateID `json:"pipeline_template_id,omitempty"`
}

func (r *CreateOpeningRequest) Normalize() {
	if r.Content != nil {
		r.Content.Normalize()
	}
	r.HiringManagerEmail = normalizeEmail(r.HiringManagerEmail)
	r.RecruiterEmail = normalizeEmail(r.RecruiterEmail)
	r.TeamMemberEmails = normalizeTeam(r.TeamMemberEmails)
	r.InternalNotes = normalizeNotes(r.InternalNotes)
}

func (r CreateOpeningRequest) Validate() []string {
	fields := []string{}
	if r.Content == nil {
		fields = append(fields, "content")
	} else {
		for _, field := range r.Content.Validate() {
			fields = append(fields, "content."+field)
		}
		// A new Opening asks only new questions (HP-QST-002).
		for index, question := range r.Content.Questions {
			field := fmt.Sprintf("content.questions.%d.id", index)
			if question.ID != nil && !slices.Contains(fields, field) {
				fields = append(fields, field)
			}
		}
	}
	fields = append(fields, validateTeam(r.HiringManagerEmail, r.RecruiterEmail, r.TeamMemberEmails, r.InternalNotes)...)
	if !validTemplate(r.PipelineTemplateID) {
		fields = append(fields, "pipeline_template_id")
	}
	return fields
}

func validTemplate(value *hiring.PipelineTemplateID) bool {
	return value == nil || hiring.IsPipelineTemplateID(*value)
}

type DuplicateOpeningRequest struct {
	OpeningNumber OpeningNumber `json:"opening_number"`

	// PipelineTemplateID overrides the source Opening's pipeline, which the
	// new Opening copies by default.
	PipelineTemplateID *hiring.PipelineTemplateID `json:"pipeline_template_id,omitempty"`
}

func (r *DuplicateOpeningRequest) Normalize() {}
func (r DuplicateOpeningRequest) Validate() []string {
	fields := []string{}
	if !validNumber(r.OpeningNumber) {
		fields = append(fields, "opening_number")
	}
	if !validTemplate(r.PipelineTemplateID) {
		fields = append(fields, "pipeline_template_id")
	}
	return fields
}

type GetOpeningRequest struct {
	OpeningNumber OpeningNumber `json:"opening_number"`
}

func (r *GetOpeningRequest) Normalize() {}
func (r GetOpeningRequest) Validate() []string {
	if !validNumber(r.OpeningNumber) {
		return []string{"opening_number"}
	}
	return []string{}
}

type ListOpeningsRequest struct {
	States              []OpeningState                 `json:"states,omitempty"`
	PendingRequestKinds []OpeningRequestKind           `json:"pending_request_kinds,omitempty"`
	AwaitingMyApproval  *bool                          `json:"awaiting_my_approval,omitempty"`
	HiringManagerEmail  *common.EmailAddress           `json:"hiring_manager_email,omitempty"`
	RecruiterEmail      *common.EmailAddress           `json:"recruiter_email,omitempty"`
	EmployingCountry    *common.CountryCode            `json:"employing_country,omitempty"`
	WorkArrangement     *common.OpeningWorkArrangement `json:"work_arrangement,omitempty"`
	EmploymentType      *common.OpeningEmploymentType  `json:"employment_type,omitempty"`
	TitleQuery          *OpeningTitleQuery             `json:"title_query,omitempty"`
	PaginationKey       *common.PaginationKey          `json:"pagination_key,omitempty"`
	Limit               *common.PageSize               `json:"limit,omitempty"`
}

func (r *ListOpeningsRequest) Normalize() {
	r.HiringManagerEmail = normalizeEmail(r.HiringManagerEmail)
	r.RecruiterEmail = normalizeEmail(r.RecruiterEmail)
	if r.EmployingCountry != nil {
		value := common.CountryCode(strings.ToUpper(strings.TrimSpace(string(*r.EmployingCountry))))
		r.EmployingCountry = &value
	}
	if r.TitleQuery != nil {
		value := OpeningTitleQuery(strings.TrimSpace(string(*r.TitleQuery)))
		r.TitleQuery = &value
	}
}

func (r ListOpeningsRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListOpeningsRequest) Validate() []string {
	fields := []string{}
	if r.States != nil {
		if len(r.States) == 0 || len(r.States) > 6 {
			fields = append(fields, "states")
		} else {
			seen := map[OpeningState]bool{}
			for _, state := range r.States {
				if !IsOpeningState(state) || seen[state] {
					fields = append(fields, "states")
					break
				}
				seen[state] = true
			}
		}
	}
	if r.PendingRequestKinds != nil {
		if len(r.PendingRequestKinds) == 0 || len(r.PendingRequestKinds) > 5 {
			fields = append(fields, "pending_request_kinds")
		} else {
			seen := map[OpeningRequestKind]bool{}
			for _, kind := range r.PendingRequestKinds {
				if !IsOpeningRequestKind(kind) || seen[kind] {
					fields = append(fields, "pending_request_kinds")
					break
				}
				seen[kind] = true
			}
		}
	}
	if r.HiringManagerEmail != nil && !common.IsEmailAddress(*r.HiringManagerEmail) {
		fields = append(fields, "hiring_manager_email")
	}
	if r.RecruiterEmail != nil && !common.IsEmailAddress(*r.RecruiterEmail) {
		fields = append(fields, "recruiter_email")
	}
	if r.EmployingCountry != nil && !common.IsCountryCode(*r.EmployingCountry) {
		fields = append(fields, "employing_country")
	}
	if r.WorkArrangement != nil && *r.WorkArrangement != common.OpeningOnSite && *r.WorkArrangement != common.OpeningHybrid && *r.WorkArrangement != common.OpeningRemote {
		fields = append(fields, "work_arrangement")
	}
	if r.EmploymentType != nil && *r.EmploymentType != common.OpeningFullTime && *r.EmploymentType != common.OpeningPartTime && *r.EmploymentType != common.OpeningContract && *r.EmploymentType != common.OpeningInternship {
		fields = append(fields, "employment_type")
	}
	if r.TitleQuery != nil && (utf8.RuneCountInString(string(*r.TitleQuery)) < 2 || utf8.RuneCountInString(string(*r.TitleQuery)) > 200) {
		fields = append(fields, "title_query")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if !common.IsPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListOpeningsResponse struct {
	Openings          []OrgOpeningSummary   `json:"openings"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type OpeningSummaryRequest struct{}

func (r *OpeningSummaryRequest) Normalize()        {}
func (r OpeningSummaryRequest) Validate() []string { return []string{} }

type OpeningSummaryResponse struct {
	Counts []OpeningStateCount `json:"counts"`
	Quota  OpeningQuotaUsage   `json:"quota"`
}

type LookupOpeningTeamMemberRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r *LookupOpeningTeamMemberRequest) Normalize() {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
}

func (r LookupOpeningTeamMemberRequest) Validate() []string {
	if !common.IsEmailAddress(r.EmailAddress) {
		return []string{"email_address"}
	}
	return []string{}
}

type LookupOpeningTeamMemberResponse struct {
	Member *OpeningTeamUser `json:"member,omitempty"`
}

type SaveOpeningWorkingCopyRequest struct {
	OpeningNumber OpeningNumber          `json:"opening_number"`
	Version       OpeningVersion         `json:"version"`
	Content       *common.OpeningContent `json:"content"`
}

func (r *SaveOpeningWorkingCopyRequest) Normalize() {
	if r.Content != nil {
		r.Content.Normalize()
	}
}
func (r SaveOpeningWorkingCopyRequest) Validate() []string {
	fields := []string{}
	if !validNumber(r.OpeningNumber) {
		fields = append(fields, "opening_number")
	}
	if !validVersion(r.Version) {
		fields = append(fields, "version")
	}
	if r.Content == nil {
		fields = append(fields, "content")
	} else {
		for _, field := range r.Content.Validate() {
			fields = append(fields, "content."+field)
		}
	}
	return fields
}

type DiscardOpeningWorkingCopyRequest struct {
	OpeningNumber OpeningNumber  `json:"opening_number"`
	Version       OpeningVersion `json:"version"`
}

func (r *DiscardOpeningWorkingCopyRequest) Normalize() {}
func (r DiscardOpeningWorkingCopyRequest) Validate() []string {
	return validateNumberVersion(r.OpeningNumber, r.Version)
}

type SetOpeningTeamRequest struct {
	OpeningNumber      OpeningNumber         `json:"opening_number"`
	Version            OpeningVersion        `json:"version"`
	HiringManagerEmail *common.EmailAddress  `json:"hiring_manager_email,omitempty"`
	RecruiterEmail     *common.EmailAddress  `json:"recruiter_email,omitempty"`
	TeamMemberEmails   []common.EmailAddress `json:"team_member_emails"`
	InternalNotes      *string               `json:"internal_notes,omitempty"`
}

func (r *SetOpeningTeamRequest) Normalize() {
	r.HiringManagerEmail = normalizeEmail(r.HiringManagerEmail)
	r.RecruiterEmail = normalizeEmail(r.RecruiterEmail)
	r.TeamMemberEmails = normalizeTeam(r.TeamMemberEmails)
	r.InternalNotes = normalizeNotes(r.InternalNotes)
}
func (r SetOpeningTeamRequest) Validate() []string {
	fields := validateNumberVersion(r.OpeningNumber, r.Version)
	return append(fields, validateTeam(r.HiringManagerEmail, r.RecruiterEmail, r.TeamMemberEmails, r.InternalNotes)...)
}

type DiscardOpeningRequest struct {
	OpeningNumber OpeningNumber  `json:"opening_number"`
	Version       OpeningVersion `json:"version"`
}

type RequestOpeningChangeRequest struct {
	OpeningNumber OpeningNumber      `json:"opening_number"`
	Version       OpeningVersion     `json:"version"`
	Kind          OpeningRequestKind `json:"kind"`
	Note          *string            `json:"note,omitempty"`
	// MarkApplicationsNotProgressing applies to a close request only.
	MarkApplicationsNotProgressing *bool `json:"mark_applications_not_progressing,omitempty"`
}

func (r *RequestOpeningChangeRequest) Normalize() { r.Note = normalizeNotes(r.Note) }
func (r RequestOpeningChangeRequest) Validate() []string {
	fields := validateNumberVersion(r.OpeningNumber, r.Version)
	if !IsOpeningRequestKind(r.Kind) {
		fields = append(fields, "kind")
	}
	if !validNotes(r.Note) {
		fields = append(fields, "note")
	}
	if r.MarkApplicationsNotProgressing != nil && r.Kind != CloseRequest {
		fields = append(fields, "mark_applications_not_progressing")
	}
	return fields
}

type DecideOpeningRequestRequest struct {
	OpeningNumber OpeningNumber   `json:"opening_number"`
	Version       OpeningVersion  `json:"version"`
	Decision      OpeningDecision `json:"decision"`
	Note          *string         `json:"note,omitempty"`
}

func (r *DecideOpeningRequestRequest) Normalize() { r.Note = normalizeNotes(r.Note) }
func (r DecideOpeningRequestRequest) Validate() []string {
	fields := validateNumberVersion(r.OpeningNumber, r.Version)
	if r.Decision != ApproveDecision && r.Decision != RejectDecision {
		fields = append(fields, "decision")
	}
	if !validNotes(r.Note) || (r.Decision == RejectDecision && r.Note == nil) {
		fields = append(fields, "note")
	}
	return fields
}

type WithdrawOpeningRequestRequest struct {
	OpeningNumber OpeningNumber  `json:"opening_number"`
	Version       OpeningVersion `json:"version"`
}

func (r *WithdrawOpeningRequestRequest) Normalize() {}
func (r WithdrawOpeningRequestRequest) Validate() []string {
	return validateNumberVersion(r.OpeningNumber, r.Version)
}

func (r *DiscardOpeningRequest) Normalize() {}
func (r DiscardOpeningRequest) Validate() []string {
	return validateNumberVersion(r.OpeningNumber, r.Version)
}

func validateNumberVersion(number OpeningNumber, version OpeningVersion) []string {
	fields := []string{}
	if !validNumber(number) {
		fields = append(fields, "opening_number")
	}
	if !validVersion(version) {
		fields = append(fields, "version")
	}
	return fields
}

type ListOpeningHistoryRequest struct {
	OpeningNumber OpeningNumber         `json:"opening_number"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *common.PageSize      `json:"limit,omitempty"`
}

func (r *ListOpeningHistoryRequest) Normalize() {}
func (r ListOpeningHistoryRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}
func (r ListOpeningHistoryRequest) Validate() []string {
	fields := []string{}
	if !validNumber(r.OpeningNumber) {
		fields = append(fields, "opening_number")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if !common.IsPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListOpeningHistoryResponse struct {
	Entries           []OpeningHistoryEntry `json:"entries"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}
