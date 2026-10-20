package marketplace

import (
	"time"

	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/openings"
)

const (
	// MaxOpeningAgencies bounds the `sourcing` engagements assigned to one
	// Opening (MKT-ASG-001).
	MaxOpeningAgencies = 20
	// MaxStageProviders bounds the engagements assigned to one stage
	// (MKT-ASG-002).
	MaxStageProviders = 10
)

// Assignment is one engagement assigned to an Opening or to one of its
// stages.
type Assignment struct {
	EngagementID EngagementID           `json:"engagement_id"`
	Counterparty EngagementCounterparty `json:"counterparty"`
	Capability   Capability             `json:"capability"`
	AssignedAt   time.Time              `json:"assigned_at"`
}

// StageAssignments are the engagements assigned to one stage.
type StageAssignments struct {
	Stage       hiring.PipelineStage `json:"stage"`
	Assignments []Assignment         `json:"assignments"`
}

// OpeningProviders is what the consumer has attached to an Opening.
type OpeningProviders struct {
	OpeningNumber openings.OpeningNumber `json:"opening_number"`
	Agencies      []Assignment           `json:"agencies"`
	Stages        []StageAssignments     `json:"stages"`
}

// ApplicationRoute is the provider performing an application's current stage.
type ApplicationRoute struct {
	EngagementID EngagementID           `json:"engagement_id"`
	Provider     EngagementCounterparty `json:"provider"`
	Capability   Capability             `json:"capability"`
	RoutedAt     time.Time              `json:"routed_at"`
}

type GetOpeningProvidersRequest struct {
	OpeningNumber openings.OpeningNumber `json:"opening_number"`
}

func (r *GetOpeningProvidersRequest) Normalize() {}

func (r GetOpeningProvidersRequest) Validate() []string {
	if r.OpeningNumber < 1 {
		return []string{"opening_number"}
	}
	return []string{}
}

// AssignOpeningProviderRequest assigns a `sourcing` engagement to the Opening
// (no StageID) or an engagement of the Capability that performs the stage's
// kind to that stage.
type AssignOpeningProviderRequest struct {
	OpeningNumber openings.OpeningNumber  `json:"opening_number"`
	EngagementID  EngagementID            `json:"engagement_id"`
	StageID       *hiring.PipelineStageID `json:"stage_id,omitempty"`
}

func (r *AssignOpeningProviderRequest) Normalize() {}

func (r AssignOpeningProviderRequest) Validate() []string {
	return validateAssignment(r.OpeningNumber, r.EngagementID, r.StageID)
}

type UnassignOpeningProviderRequest struct {
	OpeningNumber openings.OpeningNumber  `json:"opening_number"`
	EngagementID  EngagementID            `json:"engagement_id"`
	StageID       *hiring.PipelineStageID `json:"stage_id,omitempty"`
}

func (r *UnassignOpeningProviderRequest) Normalize() {}

func (r UnassignOpeningProviderRequest) Validate() []string {
	return validateAssignment(r.OpeningNumber, r.EngagementID, r.StageID)
}

func validateAssignment(
	opening openings.OpeningNumber, engagement EngagementID,
	stage *hiring.PipelineStageID,
) []string {
	fields := []string{}
	if opening < 1 {
		fields = append(fields, "opening_number")
	}
	if !IsEngagementID(engagement) {
		fields = append(fields, "engagement_id")
	}
	if stage != nil && !hiring.IsPipelineStageID(*stage) {
		fields = append(fields, "stage_id")
	}
	return fields
}
