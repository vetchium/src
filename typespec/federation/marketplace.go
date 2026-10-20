package federation

import (
	"strings"
	"time"

	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
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
