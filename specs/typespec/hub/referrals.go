package hub

import (
	"vetchium-api-server.typespec/common"
)

type ReferralState string

const (
	ReferralStatePending         ReferralState = "pending"
	ReferralStateAcceptedApplied ReferralState = "accepted_applied"
	ReferralStateDeclined        ReferralState = "declined"
	ReferralStateExpired         ReferralState = "expired"
)

type NominateColleagueRequest struct {
	CandidateHandle string `json:"candidate_handle"`
	OrgDomain       string `json:"org_domain"`
	OpeningNumber   int32  `json:"opening_number"`
	StatementText   string `json:"statement_text"`
}

type NominateColleagueResponse struct {
	NominationID string `json:"nomination_id"`
}

type ReferralReceived struct {
	NominationID        string        `json:"nomination_id"`
	ReferrerHandle      string        `json:"referrer_handle"`
	ReferrerDisplayName string        `json:"referrer_display_name"`
	OrgDomain           string        `json:"org_domain"`
	OrgName             string        `json:"org_name"`
	OpeningNumber       int32         `json:"opening_number"`
	OpeningTitle        string        `json:"opening_title"`
	SharedDomain        string        `json:"shared_domain"`
	OverlapStartYear    int32         `json:"overlap_start_year"`
	OverlapEndYear      int32         `json:"overlap_end_year"`
	StatementText       string        `json:"statement_text"`
	State               ReferralState `json:"state"`
	CreatedAt           string        `json:"created_at"`
	ExpiresAt           string        `json:"expires_at"`
}

type ReferralMade struct {
	NominationID         string        `json:"nomination_id"`
	CandidateHandle      string        `json:"candidate_handle"`
	CandidateDisplayName string        `json:"candidate_display_name"`
	OrgDomain            string        `json:"org_domain"`
	OpeningNumber        int32         `json:"opening_number"`
	OpeningTitle         string        `json:"opening_title"`
	State                ReferralState `json:"state"`
	CandidateDidApply    bool          `json:"candidate_did_apply"`
	CreatedAt            string        `json:"created_at"`
}

type ListReferralsRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

type ListReferralsReceivedResponse struct {
	Referrals         []ReferralReceived `json:"referrals"`
	NextPaginationKey *string            `json:"next_pagination_key,omitempty"`
}

type ListReferralsMadeResponse struct {
	Referrals         []ReferralMade `json:"referrals"`
	NextPaginationKey *string        `json:"next_pagination_key,omitempty"`
}

type AcceptReferralRequest struct {
	NominationID string `json:"nomination_id"`
}

type AcceptReferralResponse struct {
	OrgDomain                      string `json:"org_domain"`
	OpeningNumber                  int32  `json:"opening_number"`
	PrefillStatementForEndorsement string `json:"prefill_statement_for_endorsement"`
}

type DeclineReferralRequest struct {
	NominationID string `json:"nomination_id"`
}

func (r NominateColleagueRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.CandidateHandle == "" {
		errs = append(errs, common.ValidationError{Field: "candidate_handle", Message: "Must be a non-empty string"})
	}
	if r.OrgDomain == "" {
		errs = append(errs, common.ValidationError{Field: "org_domain", Message: "Must be a non-empty string"})
	}
	if r.OpeningNumber < 1 {
		errs = append(errs, common.ValidationError{Field: "opening_number", Message: "Must be a positive number"})
	}
	if len(r.StatementText) < 100 || len(r.StatementText) > 2000 {
		errs = append(errs, common.ValidationError{Field: "statement_text", Message: "Must be between 100 and 2000 characters"})
	}
	return errs
}

func (r ListReferralsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{Field: "limit", Message: "Must be between 1 and 100"})
	}
	return errs
}

func (r AcceptReferralRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.NominationID == "" {
		errs = append(errs, common.ValidationError{Field: "nomination_id", Message: "Must be a non-empty string"})
	}
	return errs
}

func (r DeclineReferralRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.NominationID == "" {
		errs = append(errs, common.ValidationError{Field: "nomination_id", Message: "Must be a non-empty string"})
	}
	return errs
}
