package federation

import (
	"slices"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	hubapplications "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/openings"
)

// HubApplyKind is the command a Hub user's home tenant sends to the Org's
// tenant to apply to a published Opening. Its authority principal is the Org
// and its aggregate id is the Opening number as decimal text.
const HubApplyKind CommandKind = "hub-apply"

type ApplicationReferral struct {
	AgencyDomain orgs.OrgDomain            `json:"agency_domain"`
	Route        marketplace.ReferralRoute `json:"route"`
}

type HubApplyPayload struct {
	OpeningNumber openings.OpeningNumber             `json:"opening_number"`
	ApplicantDID  hub.HubUserDID                     `json:"applicant_did"`
	Referral      *ApplicationReferral               `json:"referral,omitempty"`
	CoverNote     *applications.ApplicationCoverNote `json:"cover_note,omitempty"`
	Snapshot      profile.ApplicantSnapshot          `json:"snapshot"`
}

// Normalize trims the cover note, drops a blank one, and makes the
// snapshot's required arrays empty rather than nil. It assigns new values and
// never mutates storage the caller shares.
func (p *HubApplyPayload) Normalize() {
	if p.Referral != nil {
		referralCopy := *p.Referral
		referralCopy.AgencyDomain = orgs.NormalizeOrgDomain(referralCopy.AgencyDomain)
		p.Referral = &referralCopy
	}
	if p.CoverNote != nil {
		trimmed := applications.ApplicationCoverNote(
			strings.TrimSpace(string(*p.CoverNote)),
		)
		if trimmed == "" {
			p.CoverNote = nil
		} else {
			p.CoverNote = &trimmed
		}
	}
	p.Snapshot = p.Snapshot.Normalized()
}

func (p HubApplyPayload) Validate() []string {
	fields := []string{}
	if p.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if !hub.IsHubUserDID(p.ApplicantDID) {
		fields = append(fields, "applicant_did")
	}
	if p.Referral != nil {
		if !orgs.IsOrgDomain(p.Referral.AgencyDomain) {
			fields = append(fields, "referral.agency_domain")
		}
		if !marketplace.IsReferralRoute(p.Referral.Route) {
			fields = append(fields, "referral.route")
		}
	}
	if p.CoverNote != nil && !applications.IsApplicationCoverNote(*p.CoverNote) {
		fields = append(fields, "cover_note")
	}
	for _, field := range p.Snapshot.Validate() {
		fields = append(fields, "snapshot."+field)
	}
	return fields
}

// HubApplyResult is the stored `201` body of a successful hub-apply.
type HubApplyResult struct {
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
}

// HubWithdrawKind is the command a Hub user's home tenant sends to the Org's
// tenant to withdraw the user's application. Its authority principal is the
// Org and its aggregate id is the Opening number as decimal text.
const HubWithdrawKind CommandKind = "hub-withdraw"

type HubWithdrawPayload struct {
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
	ApplicantDID      hub.HubUserDID                 `json:"applicant_did"`
}

func (p *HubWithdrawPayload) Normalize() {}

func (p HubWithdrawPayload) Validate() []string {
	fields := []string{}
	if p.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if !applications.IsApplicationNumber(p.ApplicationNumber) {
		fields = append(fields, "application_number")
	}
	if !hub.IsHubUserDID(p.ApplicantDID) {
		fields = append(fields, "applicant_did")
	}
	return fields
}

// HubWithdrawResult is the stored `200` body of a successful hub-withdraw.
type HubWithdrawResult struct {
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
}

// HubAcceptOfferKind and HubDeclineOfferKind are the commands a Hub user's
// home tenant sends to the Org's tenant to answer the offer the user read.
// Their authority principal is the Org and their aggregate id is the Opening
// number as decimal text.
const (
	HubAcceptOfferKind  CommandKind = "hub-accept-offer"
	HubDeclineOfferKind CommandKind = "hub-decline-offer"
)

type HubOfferResponsePayload struct {
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
	OfferNumber       applications.OfferNumber       `json:"offer_number"`
	ApplicantDID      hub.HubUserDID                 `json:"applicant_did"`
}

func (p *HubOfferResponsePayload) Normalize() {}

func (p HubOfferResponsePayload) Validate() []string {
	fields := []string{}
	if p.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if !applications.IsApplicationNumber(p.ApplicationNumber) {
		fields = append(fields, "application_number")
	}
	if !applications.IsOfferNumber(p.OfferNumber) {
		fields = append(fields, "offer_number")
	}
	if !hub.IsHubUserDID(p.ApplicantDID) {
		fields = append(fields, "applicant_did")
	}
	return fields
}

// HubOfferResponseResult is the stored `200` body of a successful answer.
type HubOfferResponseResult struct {
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
	OfferNumber       applications.OfferNumber       `json:"offer_number"`
}

// HubAcceptInterviewKind and HubRescheduleInterviewKind are the commands a
// Hub user's home tenant sends to the Org's tenant to accept an interview or
// ask for it to move. Their authority principal is the Org and their
// aggregate id is the Opening number as decimal text.
const (
	HubAcceptInterviewKind     CommandKind = "hub-accept-interview"
	HubRescheduleInterviewKind CommandKind = "hub-request-interview-reschedule"
)

type HubAcceptInterviewPayload struct {
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
	InterviewNumber   applications.InterviewNumber   `json:"interview_number"`
	ApplicantDID      hub.HubUserDID                 `json:"applicant_did"`
}

func (p *HubAcceptInterviewPayload) Normalize() {}

func (p HubAcceptInterviewPayload) Validate() []string {
	fields := []string{}
	if p.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if !applications.IsApplicationNumber(p.ApplicationNumber) {
		fields = append(fields, "application_number")
	}
	if !applications.IsInterviewNumber(p.InterviewNumber) {
		fields = append(fields, "interview_number")
	}
	if !hub.IsHubUserDID(p.ApplicantDID) {
		fields = append(fields, "applicant_did")
	}
	return fields
}

// HubRescheduleInterviewPayload adds the applicant's note.
type HubRescheduleInterviewPayload struct {
	OpeningNumber     openings.OpeningNumber               `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber       `json:"application_number"`
	InterviewNumber   applications.InterviewNumber         `json:"interview_number"`
	ApplicantDID      hub.HubUserDID                       `json:"applicant_did"`
	Note              applications.InterviewRescheduleNote `json:"note"`
}

// Normalize trims the note.
func (p *HubRescheduleInterviewPayload) Normalize() {
	p.Note = applications.InterviewRescheduleNote(
		strings.TrimSpace(string(p.Note)),
	)
}

func (p HubRescheduleInterviewPayload) Validate() []string {
	fields := HubAcceptInterviewPayload{
		OpeningNumber: p.OpeningNumber, ApplicationNumber: p.ApplicationNumber,
		InterviewNumber: p.InterviewNumber, ApplicantDID: p.ApplicantDID,
	}.Validate()
	if !applications.IsInterviewRescheduleNote(p.Note) {
		fields = append(fields, "note")
	}
	return fields
}

// HubInterviewResponseResult is the stored `200` body of both commands.
type HubInterviewResponseResult struct {
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
	InterviewNumber   applications.InterviewNumber   `json:"interview_number"`
}

// HubGiveConsentKind and HubDeclineConsentKind are the commands a Hub user's
// home tenant sends to the Org's tenant to answer a background-check consent
// request. Their authority principal is the Org and their aggregate id is the
// Opening number as decimal text.
const (
	HubGiveConsentKind    CommandKind = "hub-give-background-check-consent"
	HubDeclineConsentKind CommandKind = "hub-decline-background-check-consent"
)

type HubBackgroundCheckConsentPayload struct {
	OpeningNumber     openings.OpeningNumber             `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber     `json:"application_number"`
	CheckNumber       applications.BackgroundCheckNumber `json:"check_number"`
	ApplicantDID      hub.HubUserDID                     `json:"applicant_did"`
}

func (p *HubBackgroundCheckConsentPayload) Normalize() {}

func (p HubBackgroundCheckConsentPayload) Validate() []string {
	fields := []string{}
	if p.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if !applications.IsApplicationNumber(p.ApplicationNumber) {
		fields = append(fields, "application_number")
	}
	if !applications.IsBackgroundCheckNumber(p.CheckNumber) {
		fields = append(fields, "check_number")
	}
	if !hub.IsHubUserDID(p.ApplicantDID) {
		fields = append(fields, "applicant_did")
	}
	return fields
}

// HubBackgroundCheckConsentResult is the stored `200` body of both commands.
type HubBackgroundCheckConsentResult struct {
	OpeningNumber     openings.OpeningNumber             `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber     `json:"application_number"`
	CheckNumber       applications.BackgroundCheckNumber `json:"check_number"`
}

// HubApplicationChangedKind is the event the Org's tenant enqueues on every
// change of an application for the applicant Hub user's home tenant, which
// keeps one projection row per application.
const HubApplicationChangedKind EventKind = "hub-application-changed"

// OrgApplicationAggregate versions hub-application-changed events by the
// application's version. Its aggregate id is
// "<org did>:<opening number>:<application number>".
const OrgApplicationAggregate AggregateType = "org_application"

// HubApplicationChangedPayload carries only what HP-GEN-004 allows: no stage
// name, routing, result, feedback, or Org user data.
type HubApplicationChangedPayload struct {
	OrgDID            orgs.OrgDID                         `json:"org_did"`
	OrgDomain         orgs.OrgDomain                      `json:"org_domain"`
	OrgDisplayName    common.DisplayName                  `json:"org_display_name"`
	OpeningNumber     openings.OpeningNumber              `json:"opening_number"`
	OpeningTitle      string                              `json:"opening_title"`
	ApplicationNumber applications.ApplicationNumber      `json:"application_number"`
	Status            hubapplications.ApplicationStatus   `json:"status"`
	PendingActions    []hubapplications.PendingActionKind `json:"pending_actions"`
	AppliedAt         time.Time                           `json:"applied_at"`
	LastActivityAt    time.Time                           `json:"last_activity_at"`
	// Notice asks for a notification email (HP-GEN-006); absent when the
	// applicant caused the change.
	Notice ApplicationNotice `json:"notice,omitempty"`
}

// ApplicationNotice is why an application changed, for the applicant's
// notification email. It names no interview, offer, or result content.
type ApplicationNotice string

const (
	NoticeStatusChanged      ApplicationNotice = "status_changed"
	NoticeInterviewScheduled ApplicationNotice = "interview_scheduled"
	NoticeInterviewChanged   ApplicationNotice = "interview_changed"
	NoticeInterviewCancelled ApplicationNotice = "interview_cancelled"
	NoticeConsentRequested   ApplicationNotice = "consent_requested"
	NoticeOfferExtended      ApplicationNotice = "offer_extended"
	NoticeOfferWithdrawn     ApplicationNotice = "offer_withdrawn"
	NoticeOfferExpiring      ApplicationNotice = "offer_expiring"
	NoticeOfferExpired       ApplicationNotice = "offer_expired"
)

var applicationNotices = []ApplicationNotice{
	NoticeStatusChanged, NoticeInterviewScheduled, NoticeInterviewChanged,
	NoticeInterviewCancelled, NoticeConsentRequested, NoticeOfferExtended,
	NoticeOfferWithdrawn, NoticeOfferExpiring, NoticeOfferExpired,
}

// ApplicationNotices returns every notice this contract version defines.
func ApplicationNotices() []ApplicationNotice {
	return slices.Clone(applicationNotices)
}

func IsApplicationNotice(value ApplicationNotice) bool {
	return slices.Contains(applicationNotices, value)
}

// HubApplicationRemovedKind is the event the Org's tenant enqueues when
// retention removes an application, so the applicant's home tenant deletes
// its projection row (HP-RET-001). Origin and aggregate are those of
// HubApplicationChangedKind.
const HubApplicationRemovedKind EventKind = "hub-application-removed"

type HubApplicationRemovedPayload struct {
	OrgDID            orgs.OrgDID                    `json:"org_did"`
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
}

func (p HubApplicationRemovedPayload) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(p.OrgDID) {
		fields = append(fields, "org_did")
	}
	if p.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if !applications.IsApplicationNumber(p.ApplicationNumber) {
		fields = append(fields, "application_number")
	}
	return fields
}

func (p HubApplicationChangedPayload) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(p.OrgDID) {
		fields = append(fields, "org_did")
	}
	if !orgs.IsOrgDomain(p.OrgDomain) {
		fields = append(fields, "org_domain")
	}
	if !common.IsDisplayName(p.OrgDisplayName) {
		fields = append(fields, "org_display_name")
	}
	if p.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if strings.TrimSpace(p.OpeningTitle) == "" {
		fields = append(fields, "opening_title")
	}
	if !applications.IsApplicationNumber(p.ApplicationNumber) {
		fields = append(fields, "application_number")
	}
	if !hubapplications.IsApplicationStatus(p.Status) {
		fields = append(fields, "status")
	}
	if p.PendingActions == nil {
		fields = append(fields, "pending_actions")
	}
	for _, action := range p.PendingActions {
		if !hubapplications.IsPendingActionKind(action) {
			fields = append(fields, "pending_actions")
			break
		}
	}
	if p.AppliedAt.IsZero() {
		fields = append(fields, "applied_at")
	}
	if p.LastActivityAt.Before(p.AppliedAt) {
		fields = append(fields, "last_activity_at")
	}
	if p.Notice != "" && !IsApplicationNotice(p.Notice) {
		fields = append(fields, "notice")
	}
	return fields
}
