package org

import (
	"vetchium-api-server.typespec/common"
)

type ApplicationState string
type ApplicationColorLabel string

type ListApplicationsRequest struct {
	OpeningID             string                  `json:"opening_id"`
	FilterState           []ApplicationState      `json:"filter_state,omitempty"`
	FilterLabel           []ApplicationColorLabel `json:"filter_label,omitempty"`
	FilterHasEndorsements *bool                   `json:"filter_has_endorsements,omitempty"`
	FilterAgency          *string                 `json:"filter_agency,omitempty"`
	PaginationKey         *string                 `json:"pagination_key,omitempty"`
	Limit                 *int32                  `json:"limit,omitempty"`
}

type OrgApplicationSummary struct {
	ApplicationID         string                 `json:"application_id"`
	CandidateHandle       string                 `json:"candidate_handle"`
	CandidateDisplayName  string                 `json:"candidate_display_name"`
	YOETotal              int32                  `json:"yoe_total"`
	EndorsementCount      int32                  `json:"endorsement_count"`
	ReferringAgencyDomain *string                `json:"referring_agency_domain,omitempty"`
	AIScore               *float64               `json:"ai_score,omitempty"`
	State                 ApplicationState       `json:"state"`
	Label                 *ApplicationColorLabel `json:"label,omitempty"`
	AppliedAt             string                 `json:"applied_at"`
}

type ListApplicationsResponse struct {
	Applications      []OrgApplicationSummary `json:"applications"`
	NextPaginationKey *string                 `json:"next_pagination_key,omitempty"`
}

type ApplicationIDRequest struct {
	ApplicationID string `json:"application_id"`
}

type OrgVisibleEndorsement struct {
	EndorsementID             string  `json:"endorsement_id"`
	EndorserHandle            string  `json:"endorser_handle"`
	EndorserDisplayName       string  `json:"endorser_display_name"`
	SharedDomain              string  `json:"shared_domain"`
	OverlapStartYear          int32   `json:"overlap_start_year"`
	OverlapEndYear            int32   `json:"overlap_end_year"`
	CurrentConnectionState    string  `json:"current_connection_state"`
	IsReferral                bool    `json:"is_referral"`
	IsUnsolicited             bool    `json:"is_unsolicited"`
	EndorserIsCurrentEmployee bool    `json:"endorser_is_current_employee"`
	Text                      string  `json:"text"`
	WrittenAt                 string  `json:"written_at"`
	EditedAt                  *string `json:"edited_at,omitempty"`
}

type OrgApplication struct {
	ApplicationID           string                  `json:"application_id"`
	OpeningID               string                  `json:"opening_id"`
	CandidateHandle         string                  `json:"candidate_handle"`
	CandidateDisplayName    string                  `json:"candidate_display_name"`
	CandidateShortBio       *string                 `json:"candidate_short_bio,omitempty"`
	CandidateEmployerStints []interface{}           `json:"candidate_employer_stints"` // PublicEmployerStint[]
	CoverLetter             string                  `json:"cover_letter"`
	ResumeDownloadURL       string                  `json:"resume_download_url"`
	AIScore                 *float64                `json:"ai_score,omitempty"`
	State                   ApplicationState        `json:"state"`
	Label                   *ApplicationColorLabel  `json:"label,omitempty"`
	AppliedAt               string                  `json:"applied_at"`
	StateChangedAt          string                  `json:"state_changed_at"`
	Endorsements            []OrgVisibleEndorsement `json:"endorsements"`
	NotifyColleaguesUsed    bool                    `json:"notify_colleagues_used"`
	ReferringAgencyDomain   *string                 `json:"referring_agency_domain,omitempty"`
}

type ShortlistApplicationRequest struct {
	ApplicationID string `json:"application_id"`
}

type RejectApplicationRequest struct {
	ApplicationID   string  `json:"application_id"`
	RejectionReason *string `json:"rejection_reason,omitempty"`
}

type LabelApplicationRequest struct {
	ApplicationID string                 `json:"application_id"`
	Label         *ApplicationColorLabel `json:"label,omitempty"`
}

// Validation functions
func (r *ListApplicationsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.OpeningID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "opening_id",
			Message: "is required",
		})
	}

	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{
			Field:   "limit",
			Message: "must be between 1 and 100",
		})
	}

	return errs
}

func (r *ApplicationIDRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.ApplicationID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "application_id",
			Message: "is required",
		})
	}

	return errs
}

func (r *ShortlistApplicationRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.ApplicationID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "application_id",
			Message: "is required",
		})
	}

	return errs
}

func (r *RejectApplicationRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.ApplicationID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "application_id",
			Message: "is required",
		})
	}

	if r.RejectionReason != nil && len(*r.RejectionReason) > 2000 {
		errs = append(errs, common.ValidationError{
			Field:   "rejection_reason",
			Message: "must be at most 2000 characters",
		})
	}

	return errs
}

func (r *LabelApplicationRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.ApplicationID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "application_id",
			Message: "is required",
		})
	}

	if r.Label != nil {
		if *r.Label != "green" &&
			*r.Label != "yellow" &&
			*r.Label != "red" {
			errs = append(errs, common.ValidationError{
				Field:   "label",
				Message: "must be 'green', 'yellow', 'red', or null",
			})
		}
	}

	return errs
}
