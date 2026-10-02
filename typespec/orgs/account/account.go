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
	DisplayName common.DisplayName `json:"display_name"`
	OrgState    OrgState           `json:"org_state"`
	Domain      DomainStatus       `json:"domain"`
}

type BillingNoticeKind string

const (
	// NoticePastDue is shown to every user while an invoice is unpaid.
	NoticePastDue BillingNoticeKind = "past-due"
	// NoticeSubscriptionEnding is shown to billing holders while a scheduled
	// change will lower the plan.
	NoticeSubscriptionEnding BillingNoticeKind = "subscription-ending"
)

type BillingNotice struct {
	Kind BillingNoticeKind `json:"kind"`

	// At is the deadline for past-due, and the end of the period for
	// subscription-ending.
	At time.Time `json:"at"`

	// ScheduledPlanOID is set only for subscription-ending.
	ScheduledPlanOID *subscriptions.PlanOID `json:"scheduled_plan_oid,omitempty"`

	// Banner is true when the notice is inside its final-week window. It is
	// always true for past-due.
	Banner bool `json:"banner"`
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
	BillingNotice          *BillingNotice                  `json:"billing_notice,omitempty"`
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
