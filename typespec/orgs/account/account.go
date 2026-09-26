// Package account contains the Org user's view of their account and Org.
package account

import (
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/authorization"
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
	DisplayName common.DisplayName `json:"display_name"`
	OrgState    OrgState           `json:"org_state"`
	Domain      DomainStatus       `json:"domain"`
}

type MyInfoResponse struct {
	EmailAddress      common.EmailAddress             `json:"email_address"`
	PreferredLanguage orgs.FrontendLocale             `json:"preferred_language"`
	Permissions       []authorization.OrgPermissionID `json:"permissions"`
	Org               OrgSummary                      `json:"org"`
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
