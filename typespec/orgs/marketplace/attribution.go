package marketplace

import (
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
)

type ReferralRoute string

const (
	ReferralRouteSuggested ReferralRoute = "suggested"
	ReferralRouteDeclared  ReferralRoute = "declared"
)

func IsReferralRoute(value ReferralRoute) bool {
	return value == ReferralRouteSuggested || value == ReferralRouteDeclared
}

type CreditedAgency struct {
	EngagementID EngagementID       `json:"engagement_id"`
	Domain       orgs.OrgDomain     `json:"domain"`
	DisplayName  common.DisplayName `json:"display_name"`
}
