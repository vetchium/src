package federation

import (
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	hubapplications "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/openings"
)

// HubApplyKind is the command a Hub user's home tenant sends to the Org's
// tenant to apply to a published Opening. Its authority principal is the Org
// and its aggregate id is the Opening number as decimal text.
const HubApplyKind CommandKind = "hub-apply"

type HubApplyPayload struct {
	OpeningNumber openings.OpeningNumber             `json:"opening_number"`
	ApplicantDID  hub.HubUserDID                     `json:"applicant_did"`
	CoverNote     *applications.ApplicationCoverNote `json:"cover_note,omitempty"`
	Snapshot      profile.ApplicantSnapshot          `json:"snapshot"`
}

// Normalize trims the cover note, drops a blank one, and makes the
// snapshot's required arrays empty rather than nil. It assigns new values and
// never mutates storage the caller shares.
func (p *HubApplyPayload) Normalize() {
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
	return fields
}
