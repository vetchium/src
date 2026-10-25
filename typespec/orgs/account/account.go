// Package account contains the Org user's view of their account and Org.
package account

import (
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/authorization"
	"github.com/vetchium/src/typespec/orgs/subscriptions"
)

type OrgState string

const (
	OrgActive    OrgState = "active"
	OrgSuspended OrgState = "suspended"
)

type DomainVerificationState string

const (
	DomainVerified DomainVerificationState = "verified"
	DomainFailing  DomainVerificationState = "failing"
	DomainReleased DomainVerificationState = "released"
)

type DomainStatus struct {
	Domain         orgs.OrgDomain          `json:"domain"`
	State          DomainVerificationState `json:"state"`
	DNSRecordName  string                  `json:"dns_record_name"`
	DNSRecordValue string                  `json:"dns_record_value"`
	LastVerifiedAt time.Time               `json:"last_verified_at"`
	FailingSince   *time.Time              `json:"failing_since"`
	ReleaseAfter   *time.Time              `json:"release_after"`
}

type OrgSummary struct {
	DisplayName     common.DisplayName  `json:"display_name"`
	Country         common.CountryCode  `json:"country"`
	DefaultLanguage orgs.FrontendLocale `json:"default_language"`
	OrgState        OrgState            `json:"org_state"`
	Domain          DomainStatus        `json:"domain"`
}

type MyInfoResponse struct {
	EmailAddress           common.EmailAddress             `json:"email_address"`
	PreferredLanguage      orgs.FrontendLocale             `json:"preferred_language"`
	Permissions            []authorization.OrgPermissionID `json:"permissions"`
	TOTPEnabled            bool                            `json:"totp_enabled"`
	RecoveryCodesRemaining common.TOTPRecoveryCodeCount    `json:"recovery_codes_remaining"`
	SessionAuthenticatedAt time.Time                       `json:"session_authenticated_at"`
	Org                    OrgSummary                      `json:"org"`
	PlanOID                subscriptions.PlanOID           `json:"plan_oid"`
	LogoURL                *string                         `json:"logo_url,omitempty"`
	GoogleSignInEnabled    bool                            `json:"google_sign_in_enabled"`
	Marketplace            MarketplaceRoles                `json:"marketplace"`
}

// MarketplaceRoles is what the Org does in the marketplace, which decides the
// navigation groups the portal shows; the API still decides every action.
type MarketplaceRoles struct {
	// Provider: the Org has a Listing or an engagement as provider.
	Provider bool `json:"provider"`
	// Agency: the Org has a sourcing Listing or a sourcing engagement as
	// provider.
	Agency bool `json:"agency"`
	// Services: the Org has a Listing or an engagement as provider of a stage
	// Capability (interviewing, assessment, background check).
	Services bool `json:"services"`
}

type DomainCheckResult string

const (
	CheckPresent      DomainCheckResult = "present"
	CheckAbsent       DomainCheckResult = "absent"
	CheckInconclusive DomainCheckResult = "inconclusive"
)

type CheckDomainResponse struct {
	CheckResult DomainCheckResult `json:"check_result"`
	Org         OrgSummary        `json:"org"`
}
