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
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

type AssignedOpening struct {
	OpeningID         string `json:"opening_id"`
	ConsumerOrgDomain string `json:"consumer_org_domain"`
	OpeningNumber     int32  `json:"opening_number"`
	Title             string `json:"title"`
	AssignedAt        string `json:"assigned_at"`
}

type ListAssignedOpeningsResponse struct {
	Openings          []AssignedOpening `json:"openings"`
	NextPaginationKey *string           `json:"next_pagination_key,omitempty"`
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
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

type AgencyReferral struct {
	ReferralID        string              `json:"referral_id"`
	CandidateHandle   string              `json:"candidate_handle"`
	ConsumerOrgDomain string              `json:"consumer_org_domain"`
	OpeningNumber     int32               `json:"opening_number"`
	OpeningTitle      string              `json:"opening_title"`
	State             AgencyReferralState `json:"state"`
	CreatedAt         string              `json:"created_at"`
}

type ListAgencyReferralsResponse struct {
	Referrals         []AgencyReferral `json:"referrals"`
	NextPaginationKey *string          `json:"next_pagination_key,omitempty"`
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
