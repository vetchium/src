package marketplace

import (
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
)

const (
	MaxEngagementMessage   = 2000
	MaxEngagementNote      = 2000
	MaxEngagementReference = 200
	// MaxEngagementPage bounds one page of engagements.
	MaxEngagementPage = 100
	// ProposalLifetime is how long a proposal waits for the provider before
	// it expires.
	ProposalLifetime = 30 * 24 * time.Hour
)

type EngagementID string
type EngagementVersion int32
type EngagementState string
type EngagementParty string

const (
	ProposedEngagement  EngagementState = "proposed"
	ActiveEngagement    EngagementState = "active"
	DeclinedEngagement  EngagementState = "declined"
	WithdrawnEngagement EngagementState = "withdrawn"
	ExpiredEngagement   EngagementState = "expired"
	EndedEngagement     EngagementState = "ended"
)

const (
	ConsumerParty EngagementParty = "consumer"
	ProviderParty EngagementParty = "provider"
)

var engagementStates = []EngagementState{
	ProposedEngagement, ActiveEngagement, DeclinedEngagement,
	WithdrawnEngagement, ExpiredEngagement, EndedEngagement,
}

// EngagementStates returns every engagement state this contract version
// defines.
func EngagementStates() []EngagementState { return slices.Clone(engagementStates) }

func IsEngagementState(value EngagementState) bool {
	return slices.Contains(engagementStates, value)
}

// IsTerminal reports a state no action leaves: the engagement stays readable
// to both sides, and a new proposal creates a new engagement (MKT-ENG-005).
func (s EngagementState) IsTerminal() bool {
	return s != ProposedEngagement && s != ActiveEngagement
}

func IsEngagementParty(value EngagementParty) bool {
	return value == ConsumerParty || value == ProviderParty
}

var engagementIDPattern = regexp.MustCompile(
	`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
)

// IsEngagementID accepts the lowercase form the API returns.
func IsEngagementID(value EngagementID) bool {
	return engagementIDPattern.MatchString(string(value))
}

func validEngagementVersion(value EngagementVersion) bool { return value >= 1 }

// EngagementCounterparty is the other Org of an engagement, as the viewer
// sees it.
type EngagementCounterparty struct {
	Domain      orgs.OrgDomain `json:"domain"`
	DisplayName string         `json:"display_name"`
}

// Engagement is an engagement as one of its two Orgs sees it: the
// counterparty is the provider for the consumer and the client for the
// provider. Both sides see both references.
type Engagement struct {
	ID                EngagementID           `json:"id"`
	Version           EngagementVersion      `json:"version"`
	Counterparty      EngagementCounterparty `json:"counterparty"`
	Capability        Capability             `json:"capability"`
	State             EngagementState        `json:"state"`
	Message           *string                `json:"message,omitempty"`
	ConsumerReference *string                `json:"consumer_reference,omitempty"`
	ProviderReference *string                `json:"provider_reference,omitempty"`
	EndNote           *string                `json:"end_note,omitempty"`
	EndedBy           *EngagementParty       `json:"ended_by,omitempty"`
	ProposedAt        time.Time              `json:"proposed_at"`
	ExpiresAt         time.Time              `json:"expires_at"`
	DecidedAt         *time.Time             `json:"decided_at,omitempty"`
	EndedAt           *time.Time             `json:"ended_at,omitempty"`
	UpdatedAt         time.Time              `json:"updated_at"`
}

// ValidEngagementText reports plain text of 1 to limit code points that
// PostgreSQL can hold. The federation payloads use it for the same fields.
func ValidEngagementText(value string, limit int) bool {
	return validOptionalText(&value, limit)
}

func normalizeOptionalText(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

type ProposeEngagementRequest struct {
	ProviderDomain orgs.OrgDomain `json:"provider_domain"`
	Capability     Capability     `json:"capability"`
	Message        *string        `json:"message,omitempty"`
}

func (r *ProposeEngagementRequest) Normalize() {
	r.ProviderDomain = orgs.NormalizeOrgDomain(r.ProviderDomain)
	r.Message = normalizeOptionalText(r.Message)
}

func (r ProposeEngagementRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDomain(r.ProviderDomain) {
		fields = append(fields, "provider_domain")
	}
	if !IsCapability(r.Capability) {
		fields = append(fields, "capability")
	}
	if !validOptionalText(r.Message, MaxEngagementMessage) {
		fields = append(fields, "message")
	}
	return fields
}

// EngagementTarget names an engagement and the version the caller read.
type EngagementTarget struct {
	EngagementID EngagementID      `json:"engagement_id"`
	Version      EngagementVersion `json:"version"`
}

func (r *EngagementTarget) Normalize() {}

func (r EngagementTarget) Validate() []string {
	fields := []string{}
	if !IsEngagementID(r.EngagementID) {
		fields = append(fields, "engagement_id")
	}
	if !validEngagementVersion(r.Version) {
		fields = append(fields, "version")
	}
	return fields
}

type EndEngagementRequest struct {
	EngagementID EngagementID      `json:"engagement_id"`
	Version      EngagementVersion `json:"version"`
	Note         *string           `json:"note,omitempty"`
}

func (r *EndEngagementRequest) Normalize() { r.Note = normalizeOptionalText(r.Note) }

func (r EndEngagementRequest) Validate() []string {
	fields := EngagementTarget{EngagementID: r.EngagementID, Version: r.Version}.Validate()
	if !validOptionalText(r.Note, MaxEngagementNote) {
		fields = append(fields, "note")
	}
	return fields
}

// SetEngagementReferenceRequest sets the caller's own reference; an absent
// Reference clears it.
type SetEngagementReferenceRequest struct {
	EngagementID EngagementID      `json:"engagement_id"`
	Version      EngagementVersion `json:"version"`
	Reference    *string           `json:"reference,omitempty"`
}

func (r *SetEngagementReferenceRequest) Normalize() {
	r.Reference = normalizeOptionalText(r.Reference)
}

func (r SetEngagementReferenceRequest) Validate() []string {
	fields := EngagementTarget{EngagementID: r.EngagementID, Version: r.Version}.Validate()
	if !validOptionalText(r.Reference, MaxEngagementReference) {
		fields = append(fields, "reference")
	}
	return fields
}

type GetEngagementRequest struct {
	EngagementID EngagementID `json:"engagement_id"`
}

func (r *GetEngagementRequest) Normalize() {}

func (r GetEngagementRequest) Validate() []string {
	if !IsEngagementID(r.EngagementID) {
		return []string{"engagement_id"}
	}
	return []string{}
}

type ListEngagementsRequest struct {
	State         *EngagementState      `json:"state,omitempty"`
	Capability    *Capability           `json:"capability,omitempty"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *ListEngagementsRequest) Normalize() {}

func (r ListEngagementsRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListEngagementsRequest) Validate() []string {
	fields := []string{}
	if r.State != nil && !IsEngagementState(*r.State) {
		fields = append(fields, "state")
	}
	if r.Capability != nil && !IsCapability(*r.Capability) {
		fields = append(fields, "capability")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > MaxEngagementPage) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListEngagementsResponse struct {
	Engagements       []Engagement          `json:"engagements"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}
