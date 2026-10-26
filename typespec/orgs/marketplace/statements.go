package marketplace

import (
	"regexp"
	"strings"

	"github.com/vetchium/src/typespec/common"
	openingsspec "github.com/vetchium/src/typespec/orgs/openings"
)

type BillableFactKind string

const (
	FactJoined                 BillableFactKind = "joined"
	FactSeparated              BillableFactKind = "separated"
	FactInterviewCompleted     BillableFactKind = "interview_completed"
	FactInterviewNoShow        BillableFactKind = "interview_no_show"
	FactAssessmentResult       BillableFactKind = "assessment_result"
	FactBackgroundCheckOutcome BillableFactKind = "background_check_outcome"
)

func IsBillableFactKind(kind BillableFactKind) bool {
	switch kind {
	case FactJoined, FactSeparated, FactInterviewCompleted, FactInterviewNoShow,
		FactAssessmentResult, FactBackgroundCheckOutcome:
		return true
	default:
		return false
	}
}

type StatementMonth string

var statementMonthPattern = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

func IsStatementMonth(month StatementMonth) bool {
	return statementMonthPattern.MatchString(string(month))
}

type ActivityStatementItem struct {
	FactID               string                     `json:"fact_id"`
	Date                 string                     `json:"date"`
	Fact                 BillableFactKind           `json:"fact"`
	OpeningNumber        openingsspec.OpeningNumber `json:"opening_number"`
	OpeningTitle         string                     `json:"opening_title"`
	ApplicationNumber    int32                      `json:"application_number"`
	ApplicantDisplayName string                     `json:"applicant_display_name"`
	Corrected            bool                       `json:"corrected"`
}

func (i ActivityStatementItem) Valid() bool {
	return i.FactID != "" && i.Date != "" && IsBillableFactKind(i.Fact) &&
		i.OpeningNumber > 0 && strings.TrimSpace(i.OpeningTitle) != "" &&
		i.ApplicationNumber > 0
}

type GetActivityStatementRequest struct {
	EngagementID  EngagementID          `json:"engagement_id"`
	Month         StatementMonth        `json:"month"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *GetActivityStatementRequest) Normalize() {
	r.EngagementID = EngagementID(strings.TrimSpace(string(r.EngagementID)))
	r.Month = StatementMonth(strings.TrimSpace(string(r.Month)))
}

func (r GetActivityStatementRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r GetActivityStatementRequest) Validate() []string {
	fields := []string{}
	if !IsEngagementID(r.EngagementID) {
		fields = append(fields, "engagement_id")
	}
	if !IsStatementMonth(r.Month) {
		fields = append(fields, "month")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		fields = append(fields, "limit")
	}
	return fields
}

type GetActivityStatementResponse struct {
	EngagementID      EngagementID            `json:"engagement_id"`
	Month             StatementMonth          `json:"month"`
	Items             []ActivityStatementItem `json:"items"`
	NextPaginationKey *common.PaginationKey   `json:"next_pagination_key,omitempty"`
}

func (r GetActivityStatementResponse) Valid() bool {
	if !IsEngagementID(r.EngagementID) || !IsStatementMonth(r.Month) || r.Items == nil {
		return false
	}
	for _, item := range r.Items {
		if !item.Valid() {
			return false
		}
	}
	return true
}
