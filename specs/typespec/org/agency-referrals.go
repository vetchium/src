package org

import (
	"vetchium-api-server.typespec/common"
)

// ApplicationMode controls who may apply to an opening.
type ApplicationMode string

const (
	ApplicationModeOpen       ApplicationMode = "open"
	ApplicationModeAgencyOnly ApplicationMode = "agency_only"
)

// AgencyReferralState is the lifecycle state of an agency referral.
type AgencyReferralState string

const (
	AgencyReferralStatePending         AgencyReferralState = "pending"
	AgencyReferralStateAcceptedApplied AgencyReferralState = "accepted_applied"
	AgencyReferralStateDeclined        AgencyReferralState = "declined"
	AgencyReferralStateExpired         AgencyReferralState = "expired"
	AgencyReferralStateNotSelected     AgencyReferralState = "not_selected"
)

// AgencyRecruiterRef references an agency org-user (recruiter).
type AgencyRecruiterRef struct {
	OrgUserID string `json:"org_user_id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
}

// ReferralStateCounts is the per-state referral tally for an opening.
type ReferralStateCounts struct {
	Pending         int32 `json:"pending"`
	AcceptedApplied int32 `json:"accepted_applied"`
	Declined        int32 `json:"declined"`
	Expired         int32 `json:"expired"`
	NotSelected     int32 `json:"not_selected"`
}

// ---- Consumer side: assign / list / remove agencies on an opening ----

type AssignOpeningAgencyRequest struct {
	OpeningID       string `json:"opening_id"`
	AgencyOrgDomain string `json:"agency_org_domain"`
}

type RemoveOpeningAgencyRequest struct {
	OpeningID       string `json:"opening_id"`
	AgencyOrgDomain string `json:"agency_org_domain"`
}

type ListOpeningAgenciesRequest struct {
	OpeningID string `json:"opening_id"`
}

type OpeningAgency struct {
	AgencyOrgDomain string `json:"agency_org_domain"`
	AgencyOrgName   string `json:"agency_org_name"`
	AssignedAt      string `json:"assigned_at"`
	ReferralsMade   int32  `json:"referrals_made"`
}

type ListOpeningAgenciesResponse struct {
	Agencies []OpeningAgency `json:"agencies"`
}

// ---- Agency side: openings I'm assigned to ----

type ListAssignedOpeningsRequest struct {
	FilterClientDomain *string `json:"filter_client_domain,omitempty"`
	FilterRecruiter    *string `json:"filter_recruiter,omitempty"`
	PaginationKey      *string `json:"pagination_key,omitempty"`
	Limit              *int32  `json:"limit,omitempty"`
}

type AssignedOpening struct {
	OpeningID            string               `json:"opening_id"`
	ConsumerOrgDomain    string               `json:"consumer_org_domain"`
	OpeningNumber        int32                `json:"opening_number"`
	Title                string               `json:"title"`
	AssignedAt           string               `json:"assigned_at"`
	Recruiters           []AgencyRecruiterRef `json:"recruiters"`
	RecruitersAreDefault bool                 `json:"recruiters_are_default"`
	ReferralCounts       ReferralStateCounts  `json:"referral_counts"`
}

type ListAssignedOpeningsResponse struct {
	Openings          []AssignedOpening `json:"openings"`
	NextPaginationKey *string           `json:"next_pagination_key,omitempty"`
}

type GetAssignedOpeningRequest struct {
	OpeningID string `json:"opening_id"`
}

type GetAssignedOpeningResponse struct {
	Opening AssignedOpening `json:"opening"`
}

// ---- Agency side: refer a candidate ----

type ReferCandidateRequest struct {
	OpeningID       string  `json:"opening_id"`
	CandidateHandle string  `json:"candidate_handle"`
	StatementText   *string `json:"statement_text,omitempty"`
}

type ReferCandidateResponse struct {
	ReferralID string `json:"referral_id"`
}

// ---- Agency side: referrals my agency has made ----

type ListAgencyReferralsRequest struct {
	FilterOpeningID *string `json:"filter_opening_id,omitempty"`
	PaginationKey   *string `json:"pagination_key,omitempty"`
	Limit           *int32  `json:"limit,omitempty"`
}

type AgencyReferral struct {
	ReferralID        string              `json:"referral_id"`
	CandidateHandle   string              `json:"candidate_handle"`
	ConsumerOrgDomain string              `json:"consumer_org_domain"`
	OpeningID         string              `json:"opening_id"`
	OpeningNumber     int32               `json:"opening_number"`
	OpeningTitle      string              `json:"opening_title"`
	StatementText     *string             `json:"statement_text,omitempty"`
	State             AgencyReferralState `json:"state"`
	ReferredByName    string              `json:"referred_by_name"`
	CreatedAt         string              `json:"created_at"`
	ExpiresAt         string              `json:"expires_at"`
}

type ListAgencyReferralsResponse struct {
	Referrals         []AgencyReferral `json:"referrals"`
	NextPaginationKey *string          `json:"next_pagination_key,omitempty"`
}

// ---- Agency side: internal recruiter assignment + client defaults ----

type AssignOpeningRecruitersRequest struct {
	OpeningID         string   `json:"opening_id"`
	ConsumerOrgDomain string   `json:"consumer_org_domain"`
	AgencyOrgUserIDs  []string `json:"agency_org_user_ids"`
}

type RemoveOpeningRecruiterRequest struct {
	OpeningID       string `json:"opening_id"`
	AgencyOrgUserID string `json:"agency_org_user_id"`
}

type ListAgencyRecruitersResponse struct {
	Recruiters []AgencyRecruiterRef `json:"recruiters"`
}

type ClientDefaultRecruiter struct {
	ConsumerOrgDomain string               `json:"consumer_org_domain"`
	Recruiters        []AgencyRecruiterRef `json:"recruiters"`
}

type ListClientDefaultRecruitersResponse struct {
	Defaults []ClientDefaultRecruiter `json:"defaults"`
}

type SetClientDefaultRecruitersRequest struct {
	ConsumerOrgDomain string   `json:"consumer_org_domain"`
	AgencyOrgUserIDs  []string `json:"agency_org_user_ids"`
}

type RemoveClientDefaultRecruiterRequest struct {
	ConsumerOrgDomain string `json:"consumer_org_domain"`
	AgencyOrgUserID   string `json:"agency_org_user_id"`
}

func (r AssignOpeningAgencyRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OpeningID == "" {
		errs = append(errs, common.ValidationError{Field: "opening_id", Message: "Must be a non-empty string"})
	}
	if r.AgencyOrgDomain == "" {
		errs = append(errs, common.ValidationError{Field: "agency_org_domain", Message: "Must be a non-empty string"})
	}
	return errs
}

func (r RemoveOpeningAgencyRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OpeningID == "" {
		errs = append(errs, common.ValidationError{Field: "opening_id", Message: "Must be a non-empty string"})
	}
	if r.AgencyOrgDomain == "" {
		errs = append(errs, common.ValidationError{Field: "agency_org_domain", Message: "Must be a non-empty string"})
	}
	return errs
}

func (r ListOpeningAgenciesRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OpeningID == "" {
		errs = append(errs, common.ValidationError{Field: "opening_id", Message: "Must be a non-empty string"})
	}
	return errs
}

func (r ListAssignedOpeningsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{Field: "limit", Message: "Must be between 1 and 100"})
	}
	return errs
}

func (r ReferCandidateRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OpeningID == "" {
		errs = append(errs, common.ValidationError{Field: "opening_id", Message: "Must be a non-empty string"})
	}
	if r.CandidateHandle == "" {
		errs = append(errs, common.ValidationError{Field: "candidate_handle", Message: "Must be a non-empty string"})
	}
	if r.StatementText != nil && len(*r.StatementText) > 2000 {
		errs = append(errs, common.ValidationError{Field: "statement_text", Message: "Must be at most 2000 characters"})
	}
	return errs
}

func (r ListAgencyReferralsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{Field: "limit", Message: "Must be between 1 and 100"})
	}
	return errs
}

func (r GetAssignedOpeningRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OpeningID == "" {
		errs = append(errs, common.ValidationError{Field: "opening_id", Message: "Must be a non-empty string"})
	}
	return errs
}

func validateOrgUserIDs(ids []string) []common.ValidationError {
	var errs []common.ValidationError
	if len(ids) == 0 {
		errs = append(errs, common.ValidationError{Field: "agency_org_user_ids", Message: "At least one recruiter is required"})
		return errs
	}
	for _, id := range ids {
		if id == "" {
			errs = append(errs, common.ValidationError{Field: "agency_org_user_ids", Message: "Each id must be a non-empty string"})
			break
		}
	}
	return errs
}

func (r AssignOpeningRecruitersRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OpeningID == "" {
		errs = append(errs, common.ValidationError{Field: "opening_id", Message: "Must be a non-empty string"})
	}
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.ValidationError{Field: "consumer_org_domain", Message: "Must be a non-empty string"})
	}
	errs = append(errs, validateOrgUserIDs(r.AgencyOrgUserIDs)...)
	return errs
}

func (r RemoveOpeningRecruiterRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.OpeningID == "" {
		errs = append(errs, common.ValidationError{Field: "opening_id", Message: "Must be a non-empty string"})
	}
	if r.AgencyOrgUserID == "" {
		errs = append(errs, common.ValidationError{Field: "agency_org_user_id", Message: "Must be a non-empty string"})
	}
	return errs
}

func (r SetClientDefaultRecruitersRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.ValidationError{Field: "consumer_org_domain", Message: "Must be a non-empty string"})
	}
	errs = append(errs, validateOrgUserIDs(r.AgencyOrgUserIDs)...)
	return errs
}

func (r RemoveClientDefaultRecruiterRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ConsumerOrgDomain == "" {
		errs = append(errs, common.ValidationError{Field: "consumer_org_domain", Message: "Must be a non-empty string"})
	}
	if r.AgencyOrgUserID == "" {
		errs = append(errs, common.ValidationError{Field: "agency_org_user_id", Message: "Must be a non-empty string"})
	}
	return errs
}
