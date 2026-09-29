package hub

import (
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"
)

var SignupDomainNotAllowedError = problem.Details{
	Type:   "vetchium-problem-details/hub-signup-domain-not-allowed",
	Title:  "Hub signup domain not allowed",
	Status: 403,
	Detail: "This tenant does not allow Hub signup with that email domain",
}

var InvalidSignupTokenError = problem.Details{
	Type:   "vetchium-problem-details/hub-invalid-signup-token",
	Title:  "Invalid Hub signup token",
	Status: 401,
	Detail: "Signup token is invalid, expired, consumed, or no longer eligible",
}

var SignupUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/hub-signup-unavailable",
	Title:  "Hub signup unavailable",
	Status: 403,
	Detail: "This region is not accepting signup for your resident country. Choose another region.",
}

// HubAccountHomedElsewhereDetails.
type HubAccountHomedElsewhereDetails struct {
	problem.Details
	TenantID       string             `json:"tenant_id"`
	HostingCountry common.CountryCode `json:"hosting_country"`
	HubURL         string             `json:"hub_url"`
}

func HubAccountHomedElsewhereError(
	tenantID string, hostingCountry common.CountryCode, hubURL string,
) HubAccountHomedElsewhereDetails {
	return HubAccountHomedElsewhereDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/hub-account-homed-elsewhere",
			Title:  "Hub account homed in another region",
			Status: 409,
			Detail: "This Hub account signs in at another region's Hub portal",
		},
		TenantID: tenantID, HostingCountry: hostingCountry, HubURL: hubURL,
	}
}
