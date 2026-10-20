package federation

import (
	"slices"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
)

// Engagement commands are sent by the provider's tenant to the consumer's
// tenant, which is authoritative for the engagement. Their authority
// principal is the consumer Org and their aggregate id is the engagement id.
const (
	EngagementAcceptKind       CommandKind = "engagement-accept"
	EngagementDeclineKind      CommandKind = "engagement-decline"
	EngagementEndKind          CommandKind = "engagement-end"
	EngagementSetReferenceKind CommandKind = "engagement-set-reference"
)

// EngagementChangedKind is the event the consumer's tenant enqueues on every
// change of an engagement for the provider's tenant, which keeps one
// non-authoritative projection row per engagement (MKT-GEN-004).
const EngagementChangedKind EventKind = "engagement-changed"

// EngagementAggregate versions engagement-changed events by the engagement's
// version. Its aggregate id is the engagement id.
const EngagementAggregate AggregateType = "org_engagement"

// EngagementSnapshotOrg is one Org of an engagement as the consumer's tenant
// recorded it.
type EngagementSnapshotOrg struct {
	OrgDID      orgs.OrgDID    `json:"org_did"`
	Domain      orgs.OrgDomain `json:"domain"`
	DisplayName string         `json:"display_name"`
}

func (o EngagementSnapshotOrg) validate(prefix string) []string {
	fields := []string{}
	if !orgs.IsOrgDID(o.OrgDID) {
		fields = append(fields, prefix+".org_did")
	}
	if !orgs.IsOrgDomain(o.Domain) {
		fields = append(fields, prefix+".domain")
	}
	if strings.TrimSpace(o.DisplayName) == "" {
		fields = append(fields, prefix+".display_name")
	}
	return fields
}

// EngagementSnapshot is an engagement in full: the stored `200` result of
// every engagement command and the payload of engagement-changed.
type EngagementSnapshot struct {
	EngagementID      marketplace.EngagementID      `json:"engagement_id"`
	Version           marketplace.EngagementVersion `json:"version"`
	Consumer          EngagementSnapshotOrg         `json:"consumer"`
	Provider          EngagementSnapshotOrg         `json:"provider"`
	Capability        marketplace.Capability        `json:"capability"`
	State             marketplace.EngagementState   `json:"state"`
	Message           *string                       `json:"message,omitempty"`
	ConsumerReference *string                       `json:"consumer_reference,omitempty"`
	ProviderReference *string                       `json:"provider_reference,omitempty"`
	EndNote           *string                       `json:"end_note,omitempty"`
	EndedBy           *marketplace.EngagementParty  `json:"ended_by,omitempty"`
	ProposedAt        time.Time                     `json:"proposed_at"`
	ExpiresAt         time.Time                     `json:"expires_at"`
	DecidedAt         *time.Time                    `json:"decided_at,omitempty"`
	EndedAt           *time.Time                    `json:"ended_at,omitempty"`
	UpdatedAt         time.Time                     `json:"updated_at"`
}

func (s EngagementSnapshot) Validate() []string {
	fields := []string{}
	if !marketplace.IsEngagementID(s.EngagementID) {
		fields = append(fields, "engagement_id")
	}
	if s.Version < 1 {
		fields = append(fields, "version")
	}
	fields = append(fields, s.Consumer.validate("consumer")...)
	fields = append(fields, s.Provider.validate("provider")...)
	if s.Consumer.OrgDID == s.Provider.OrgDID {
		fields = append(fields, "provider.org_did")
	}
	if !marketplace.IsCapability(s.Capability) {
		fields = append(fields, "capability")
	}
	if !marketplace.IsEngagementState(s.State) {
		fields = append(fields, "state")
	}
	if s.EndedBy != nil && !marketplace.IsEngagementParty(*s.EndedBy) {
		fields = append(fields, "ended_by")
	}
	if s.ProposedAt.IsZero() {
		fields = append(fields, "proposed_at")
	}
	if !s.ExpiresAt.After(s.ProposedAt) {
		fields = append(fields, "expires_at")
	}
	if s.UpdatedAt.Before(s.ProposedAt) {
		fields = append(fields, "updated_at")
	}
	return fields
}

// ViewFor derives the engagement as the Org on side sees it: the other Org is
// the counterparty.
func (s EngagementSnapshot) ViewFor(
	side marketplace.EngagementParty,
) marketplace.Engagement {
	other := s.Provider
	if side == marketplace.ProviderParty {
		other = s.Consumer
	}
	view := marketplace.Engagement{
		ID: s.EngagementID, Version: s.Version,
		Counterparty: marketplace.EngagementCounterparty{
			Domain: other.Domain, DisplayName: other.DisplayName,
		},
		Capability: s.Capability, State: s.State, Message: s.Message,
		ConsumerReference: s.ConsumerReference,
		ProviderReference: s.ProviderReference,
		EndNote:           s.EndNote, EndedBy: s.EndedBy,
		ProposedAt: s.ProposedAt.UTC(), ExpiresAt: s.ExpiresAt.UTC(),
		UpdatedAt: s.UpdatedAt.UTC(),
	}
	if s.DecidedAt != nil {
		decided := s.DecidedAt.UTC()
		view.DecidedAt = &decided
	}
	if s.EndedAt != nil {
		ended := s.EndedAt.UTC()
		view.EndedAt = &ended
	}
	return view
}

// EngagementActorPayload is what every provider command carries: the
// engagement and the version the provider read, the provider Org that acts
// (the command's initiator), its current display name, and the acting user's
// display name. The consumer's tenant records the last two in its audit
// event and refreshes the provider's display name.
type EngagementActorPayload struct {
	EngagementID        marketplace.EngagementID      `json:"engagement_id"`
	Version             marketplace.EngagementVersion `json:"version"`
	ProviderOrgDID      orgs.OrgDID                   `json:"provider_org_did"`
	ProviderDisplayName string                        `json:"provider_display_name"`
	ActorDisplayName    string                        `json:"actor_display_name"`
}

func (p *EngagementActorPayload) Normalize() {
	p.ProviderDisplayName = strings.TrimSpace(p.ProviderDisplayName)
	p.ActorDisplayName = strings.TrimSpace(p.ActorDisplayName)
}

func (p EngagementActorPayload) Validate() []string {
	fields := marketplace.EngagementTarget{
		EngagementID: p.EngagementID, Version: p.Version,
	}.Validate()
	if !orgs.IsOrgDID(p.ProviderOrgDID) {
		fields = append(fields, "provider_org_did")
	}
	if p.ProviderDisplayName == "" || len([]rune(p.ProviderDisplayName)) > 200 {
		fields = append(fields, "provider_display_name")
	}
	if p.ActorDisplayName == "" || len([]rune(p.ActorDisplayName)) > 200 {
		fields = append(fields, "actor_display_name")
	}
	return fields
}

// EngagementDecisionPayload is the payload of engagement-accept and
// engagement-decline.
type EngagementDecisionPayload = EngagementActorPayload

// EngagementEndPayload is the payload of engagement-end.
type EngagementEndPayload struct {
	EngagementActorPayload
	Note *string `json:"note,omitempty"`
}

func (p *EngagementEndPayload) Normalize() {
	p.EngagementActorPayload.Normalize()
	if p.Note != nil {
		note := strings.TrimSpace(*p.Note)
		p.Note = &note
	}
}

func (p EngagementEndPayload) Validate() []string {
	fields := p.EngagementActorPayload.Validate()
	if p.Note != nil && !marketplace.ValidEngagementText(*p.Note, marketplace.MaxEngagementNote) {
		fields = append(fields, "note")
	}
	return fields
}

// EngagementReferencePayload is the payload of engagement-set-reference; an
// absent reference clears it.
type EngagementReferencePayload struct {
	EngagementActorPayload
	Reference *string `json:"reference,omitempty"`
}

func (p *EngagementReferencePayload) Normalize() {
	p.EngagementActorPayload.Normalize()
	if p.Reference != nil {
		reference := strings.TrimSpace(*p.Reference)
		p.Reference = &reference
	}
}

func (p EngagementReferencePayload) Validate() []string {
	fields := p.EngagementActorPayload.Validate()
	if p.Reference != nil &&
		!marketplace.ValidEngagementText(*p.Reference, marketplace.MaxEngagementReference) {
		fields = append(fields, "reference")
	}
	return fields
}

// Provider work commands are sent by the provider's tenant to the client's
// tenant, which is authoritative for the candidacy. Their authority principal
// is the client Org, the initiator is the provider Org the payload names, and
// their aggregate id is the work id. Every refusal of the client's tenant is
// one answer, org-engagement-work-not-found, so a provider learns nothing
// about what it may not reach (MKT-ACC-004).
const (
	WorkScheduleInterviewKind     CommandKind = "work-schedule-interview"
	WorkChangeInterviewKind       CommandKind = "work-change-interview"
	WorkCancelInterviewKind       CommandKind = "work-cancel-interview"
	WorkInterviewOutcomeKind      CommandKind = "work-record-interview-outcome"
	WorkInterviewFeedbackKind     CommandKind = "work-submit-interview-feedback"
	WorkAssessmentKind            CommandKind = "work-record-assessment"
	WorkBackgroundCheckResultKind CommandKind = "work-record-background-check-result"
)

// WorkActor is what every provider work command carries: the work and its
// engagement, the provider Org that acts (the command's initiator), and the
// acting user's email address, who stands for the provider's user in the
// client's records.
type WorkActor struct {
	EngagementID   marketplace.EngagementID `json:"engagement_id"`
	WorkID         work.WorkID              `json:"work_id"`
	ProviderOrgDID orgs.OrgDID              `json:"provider_org_did"`
	ActorEmail     common.EmailAddress      `json:"actor_email"`
}

func (a *WorkActor) Normalize() {
	a.ActorEmail = common.NormalizeEmailAddress(a.ActorEmail)
}

func (a WorkActor) Validate() []string {
	fields := work.WorkReference{EngagementID: a.EngagementID, WorkID: a.WorkID}.Validate()
	if !orgs.IsOrgDID(a.ProviderOrgDID) {
		fields = append(fields, "provider_org_did")
	}
	if !common.IsEmailAddress(a.ActorEmail) {
		fields = append(fields, "actor_email")
	}
	return fields
}

// WorkScheduleInterviewPayload is the payload of work-schedule-interview.
type WorkScheduleInterviewPayload struct {
	WorkActor
	applications.InterviewDetails
}

func (p *WorkScheduleInterviewPayload) Normalize() {
	p.WorkActor.Normalize()
	request := work.ScheduleInterviewRequest{InterviewDetails: p.InterviewDetails}
	request.Normalize()
	p.InterviewDetails = request.InterviewDetails
}

func (p WorkScheduleInterviewPayload) Validate() []string {
	fields := p.WorkActor.Validate()
	request := work.ScheduleInterviewRequest{
		EngagementID: p.EngagementID, WorkID: p.WorkID,
		InterviewDetails: p.InterviewDetails,
	}
	return mergeFields(fields, request.Validate())
}

// WorkChangeInterviewPayload is the payload of work-change-interview.
type WorkChangeInterviewPayload struct {
	WorkActor
	InterviewNumber applications.InterviewNumber `json:"interview_number"`
	applications.InterviewDetails
}

func (p *WorkChangeInterviewPayload) Normalize() {
	p.WorkActor.Normalize()
	request := work.ChangeInterviewRequest{InterviewDetails: p.InterviewDetails}
	request.Normalize()
	p.InterviewDetails = request.InterviewDetails
}

func (p WorkChangeInterviewPayload) Validate() []string {
	request := work.ChangeInterviewRequest{
		EngagementID: p.EngagementID, WorkID: p.WorkID,
		InterviewNumber:  p.InterviewNumber,
		InterviewDetails: p.InterviewDetails,
	}
	return mergeFields(p.WorkActor.Validate(), request.Validate())
}

// WorkInterviewReferencePayload is the payload of work-cancel-interview.
type WorkInterviewReferencePayload struct {
	WorkActor
	InterviewNumber applications.InterviewNumber `json:"interview_number"`
}

func (p *WorkInterviewReferencePayload) Normalize() { p.WorkActor.Normalize() }

func (p WorkInterviewReferencePayload) Validate() []string {
	request := work.InterviewReference{
		EngagementID: p.EngagementID, WorkID: p.WorkID,
		InterviewNumber: p.InterviewNumber,
	}
	return mergeFields(p.WorkActor.Validate(), request.Validate())
}

// WorkInterviewOutcomePayload is the payload of work-record-interview-outcome.
type WorkInterviewOutcomePayload struct {
	WorkActor
	InterviewNumber applications.InterviewNumber  `json:"interview_number"`
	Outcome         applications.InterviewOutcome `json:"outcome"`
}

func (p *WorkInterviewOutcomePayload) Normalize() { p.WorkActor.Normalize() }

func (p WorkInterviewOutcomePayload) Validate() []string {
	request := work.RecordInterviewOutcomeRequest{
		EngagementID: p.EngagementID, WorkID: p.WorkID,
		InterviewNumber: p.InterviewNumber, Outcome: p.Outcome,
	}
	return mergeFields(p.WorkActor.Validate(), request.Validate())
}

// WorkInterviewFeedbackPayload is the payload of work-submit-interview-
// feedback. The actor is the interviewer who submits.
type WorkInterviewFeedbackPayload struct {
	WorkActor
	InterviewNumber applications.InterviewNumber         `json:"interview_number"`
	Recommendation  applications.InterviewRecommendation `json:"recommendation"`
	Notes           applications.InterviewFeedbackNotes  `json:"notes"`
}

func (p *WorkInterviewFeedbackPayload) Normalize() {
	p.WorkActor.Normalize()
	request := work.SubmitInterviewFeedbackRequest{Notes: p.Notes}
	request.Normalize()
	p.Notes = request.Notes
}

func (p WorkInterviewFeedbackPayload) Validate() []string {
	request := work.SubmitInterviewFeedbackRequest{
		EngagementID: p.EngagementID, WorkID: p.WorkID,
		InterviewNumber: p.InterviewNumber, Recommendation: p.Recommendation,
		Notes: p.Notes,
	}
	return mergeFields(p.WorkActor.Validate(), request.Validate())
}

// WorkAssessmentPayload is the payload of work-record-assessment.
type WorkAssessmentPayload struct {
	WorkActor
	Outcome   applications.AssessmentOutcome `json:"outcome"`
	Score     *applications.AssessmentScore  `json:"score,omitempty"`
	Notes     *applications.ResultNotes      `json:"notes,omitempty"`
	ReportURL *profile.WebsiteURL            `json:"report_url,omitempty"`
}

func (p *WorkAssessmentPayload) Normalize() {
	p.WorkActor.Normalize()
	request := work.RecordAssessmentRequest{Notes: p.Notes, ReportURL: p.ReportURL}
	request.Normalize()
	p.Notes, p.ReportURL = request.Notes, request.ReportURL
}

func (p WorkAssessmentPayload) Validate() []string {
	request := work.RecordAssessmentRequest{
		EngagementID: p.EngagementID, WorkID: p.WorkID, Outcome: p.Outcome,
		Score: p.Score, Notes: p.Notes, ReportURL: p.ReportURL,
	}
	return mergeFields(p.WorkActor.Validate(), request.Validate())
}

// WorkBackgroundCheckResultPayload is the payload of
// work-record-background-check-result.
type WorkBackgroundCheckResultPayload struct {
	WorkActor
	CheckType hiring.CheckType          `json:"check_type"`
	Outcome   applications.CheckOutcome `json:"outcome"`
	Notes     *applications.ResultNotes `json:"notes,omitempty"`
	ReportURL *profile.WebsiteURL       `json:"report_url,omitempty"`
}

func (p *WorkBackgroundCheckResultPayload) Normalize() {
	p.WorkActor.Normalize()
	request := work.RecordBackgroundCheckResultRequest{Notes: p.Notes, ReportURL: p.ReportURL}
	request.Normalize()
	p.Notes, p.ReportURL = request.Notes, request.ReportURL
}

func (p WorkBackgroundCheckResultPayload) Validate() []string {
	request := work.RecordBackgroundCheckResultRequest{
		EngagementID: p.EngagementID, WorkID: p.WorkID, CheckType: p.CheckType,
		Outcome: p.Outcome, Notes: p.Notes, ReportURL: p.ReportURL,
	}
	return mergeFields(p.WorkActor.Validate(), request.Validate())
}

// mergeFields joins two field lists, each of which names the engagement and
// work id fields it checks, without repeating one.
func mergeFields(first, second []string) []string {
	merged := append([]string{}, first...)
	for _, field := range second {
		if !slices.Contains(merged, field) {
			merged = append(merged, field)
		}
	}
	return merged
}
