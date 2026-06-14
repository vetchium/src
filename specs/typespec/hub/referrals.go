package hub

import (
	"vetchium-api-server.typespec/common"
)

// AgencyReferralState mirrors org.AgencyReferralState (kept local to avoid a
// cross-package import); the wire values are identical.
type AgencyReferralState string

const (
	AgencyReferralStatePending         AgencyReferralState = "pending"
	AgencyReferralStateAcceptedApplied AgencyReferralState = "accepted_applied"
	AgencyReferralStateDeclined        AgencyReferralState = "declined"
	AgencyReferralStateExpired         AgencyReferralState = "expired"
	AgencyReferralStateNotSelected     AgencyReferralState = "not_selected"
)

type ListReferralsReceivedRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

type ReferralReceived struct {
	ReferralID        string              `json:"referral_id"`
	AgencyOrgDomain   string              `json:"agency_org_domain"`
	AgencyOrgName     string              `json:"agency_org_name"`
	ConsumerOrgDomain string              `json:"consumer_org_domain"`
	OpeningNumber     int32               `json:"opening_number"`
	OpeningTitle      string              `json:"opening_title"`
	StatementText     *string             `json:"statement_text,omitempty"`
	State             AgencyReferralState `json:"state"`
	CreatedAt         string              `json:"created_at"`
	ExpiresAt         string              `json:"expires_at"`
}

type ListReferralsReceivedResponse struct {
	Referrals         []ReferralReceived `json:"referrals"`
	NextPaginationKey *string            `json:"next_pagination_key,omitempty"`
}

type DeclineReferralRequest struct {
	ReferralID string `json:"referral_id"`
}

func (r ListReferralsReceivedRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{Field: "limit", Message: "Must be between 1 and 100"})
	}
	return errs
}

func (r DeclineReferralRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ReferralID == "" {
		errs = append(errs, common.ValidationError{Field: "referral_id", Message: "Must be a non-empty string"})
	}
	return errs
}
