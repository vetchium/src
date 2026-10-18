// Package openings contains Org Opening API wire types.
package openings

import (
	"time"

	"github.com/vetchium/src/typespec/common"
)

type OpeningNumber int32
type OpeningVersion int32
type OpeningState string
type OpeningRequestKind string
type OpeningRequestState string
type OpeningDecision string
type OpeningHistoryAction string

const (
	Draft     OpeningState = "draft"
	Discarded OpeningState = "discarded"
	Published OpeningState = "published"
	Paused    OpeningState = "paused"
	Closed    OpeningState = "closed"
	Expired   OpeningState = "expired"

	PublishRequest OpeningRequestKind = "publish"
	ReviseRequest  OpeningRequestKind = "revise"
	PauseRequest   OpeningRequestKind = "pause"
	ReopenRequest  OpeningRequestKind = "reopen"
	CloseRequest   OpeningRequestKind = "close"

	RequestPending    OpeningRequestState = "pending"
	RequestApproved   OpeningRequestState = "approved"
	RequestRejected   OpeningRequestState = "rejected"
	RequestWithdrawn  OpeningRequestState = "withdrawn"
	RequestSuperseded OpeningRequestState = "superseded"
	RequestCancelled  OpeningRequestState = "cancelled"

	ApproveDecision OpeningDecision = "approve"
	RejectDecision  OpeningDecision = "reject"

	HistoryCreated           OpeningHistoryAction = "created"
	HistoryDuplicated        OpeningHistoryAction = "duplicated"
	HistoryWorkingCopySaved  OpeningHistoryAction = "working_copy_saved"
	HistoryTeamChanged       OpeningHistoryAction = "team_changed"
	HistoryPipelineChanged   OpeningHistoryAction = "pipeline_changed"
	HistoryRevisionDiscarded OpeningHistoryAction = "revision_discarded"
	HistoryDiscarded         OpeningHistoryAction = "discarded"
	HistoryRequested         OpeningHistoryAction = "requested"
	HistoryApproved          OpeningHistoryAction = "approved"
	HistorySelfApproved      OpeningHistoryAction = "self_approved"
	HistoryRejected          OpeningHistoryAction = "rejected"
	HistoryWithdrawn         OpeningHistoryAction = "withdrawn"
	HistorySuperseded        OpeningHistoryAction = "superseded"
	HistoryCancelled         OpeningHistoryAction = "cancelled"
	HistoryExpired           OpeningHistoryAction = "expired"
)

func IsOpeningState(value OpeningState) bool {
	switch value {
	case Draft, Discarded, Published, Paused, Closed, Expired:
		return true
	default:
		return false
	}
}

func IsOpeningRequestKind(value OpeningRequestKind) bool {
	switch value {
	case PublishRequest, ReviseRequest, PauseRequest, ReopenRequest, CloseRequest:
		return true
	default:
		return false
	}
}

type OpeningTeamUser struct {
	Email  common.EmailAddress `json:"email"`
	Active bool                `json:"active"`
}

type PendingOpeningRequest struct {
	Kind             OpeningRequestKind  `json:"kind"`
	RequestedByEmail common.EmailAddress `json:"requested_by_email"`
	RequestedAt      time.Time           `json:"requested_at"`
	Note             *string             `json:"note,omitempty"`
}

type OrgOpening struct {
	OpeningNumber    OpeningNumber          `json:"opening_number"`
	State            OpeningState           `json:"state"`
	Version          OpeningVersion         `json:"version"`
	Revision         int32                  `json:"revision"`
	LiveContent      *common.OpeningContent `json:"live_content,omitempty"`
	WorkingContent   *common.OpeningContent `json:"working_content,omitempty"`
	PendingRequest   *PendingOpeningRequest `json:"pending_request,omitempty"`
	HiringManager    *OpeningTeamUser       `json:"hiring_manager,omitempty"`
	Recruiter        *OpeningTeamUser       `json:"recruiter,omitempty"`
	TeamMembers      []OpeningTeamUser      `json:"team_members"`
	InternalNotes    *string                `json:"internal_notes,omitempty"`
	CreatedByEmail   common.EmailAddress    `json:"created_by_email"`
	CreatedAt        time.Time              `json:"created_at"`
	UpdatedAt        time.Time              `json:"updated_at"`
	FirstPublishedAt *time.Time             `json:"first_published_at,omitempty"`
	ExpiresAt        *time.Time             `json:"expires_at,omitempty"`
	LastRevisedAt    *time.Time             `json:"last_revised_at,omitempty"`
	EndedAt          *time.Time             `json:"ended_at,omitempty"`
}

type OrgOpeningSummary struct {
	OpeningNumber      OpeningNumber                  `json:"opening_number"`
	State              OpeningState                   `json:"state"`
	Title              *string                        `json:"title,omitempty"`
	EmployingCountry   *common.CountryCode            `json:"employing_country,omitempty"`
	WorkArrangement    *common.OpeningWorkArrangement `json:"work_arrangement,omitempty"`
	EmploymentType     *common.OpeningEmploymentType  `json:"employment_type,omitempty"`
	HiringManagerEmail *common.EmailAddress           `json:"hiring_manager_email,omitempty"`
	RecruiterEmail     *common.EmailAddress           `json:"recruiter_email,omitempty"`
	PendingRequestKind *OpeningRequestKind            `json:"pending_request_kind,omitempty"`
	UpdatedAt          time.Time                      `json:"updated_at"`
	ExpiresAt          *time.Time                     `json:"expires_at,omitempty"`
}

type OpeningStateCount struct {
	State OpeningState `json:"state"`
	Count int32        `json:"count"`
}

type OpeningQuotaUsage struct {
	Limit       int32     `json:"limit"`
	Used        int32     `json:"used"`
	WindowStart time.Time `json:"window_start"`
}

type OpeningHistoryEntry struct {
	Action              OpeningHistoryAction `json:"action"`
	ActorEmail          *common.EmailAddress `json:"actor_email,omitempty"`
	RequestKind         *OpeningRequestKind  `json:"request_kind,omitempty"`
	RequestState        *OpeningRequestState `json:"request_state,omitempty"`
	RequestNote         *string              `json:"request_note,omitempty"`
	DecisionNote        *string              `json:"decision_note,omitempty"`
	SourceOpeningNumber *OpeningNumber       `json:"source_opening_number,omitempty"`
	Version             OpeningVersion       `json:"version"`
	CreatedAt           time.Time            `json:"created_at"`
}
