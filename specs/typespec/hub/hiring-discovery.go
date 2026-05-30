package hub

import (
	"vetchium-api-server.typespec/common"
)

type EmploymentType string
type WorkLocationType string

const (
	EmploymentTypeFullTime   EmploymentType = "full_time"
	EmploymentTypePartTime   EmploymentType = "part_time"
	EmploymentTypeContract   EmploymentType = "contract"
	EmploymentTypeInternship EmploymentType = "internship"

	WorkLocationTypeRemote WorkLocationType = "remote"
	WorkLocationTypeOnSite WorkLocationType = "on_site"
	WorkLocationTypeHybrid WorkLocationType = "hybrid"
)

type HubOpeningCard struct {
	OrgDomain          string           `json:"org_domain"`
	OrgName            string           `json:"org_name"`
	OpeningNumber      int32            `json:"opening_number"`
	Title              string           `json:"title"`
	PrimaryCity        *string          `json:"primary_city,omitempty"`
	EmploymentType     EmploymentType   `json:"employment_type"`
	WorkLocationType   WorkLocationType `json:"work_location_type"`
	FirstPublishedAt   string           `json:"first_published_at"`
	ColleagueCountHere int32            `json:"colleague_count_here"`
}

type HubListOpeningsRequest struct {
	FilterQuery              *string            `json:"filter_query,omitempty"`
	FilterEmploymentType     []EmploymentType   `json:"filter_employment_type,omitempty"`
	FilterWorkLocationType   []WorkLocationType `json:"filter_work_location_type,omitempty"`
	FilterCountry            *string            `json:"filter_country,omitempty"`
	FilterMinYOE             *int32             `json:"filter_min_yoe,omitempty"`
	FilterTagIDs             []string           `json:"filter_tag_ids,omitempty"`
	FilterOnlyWithColleagues *bool              `json:"filter_only_with_colleagues,omitempty"`
	PaginationKey            *string            `json:"pagination_key,omitempty"`
	Limit                    *int32             `json:"limit,omitempty"`
}

type HubListOpeningsResponse struct {
	Openings          []HubOpeningCard `json:"openings"`
	NextPaginationKey *string          `json:"next_pagination_key,omitempty"`
}

type HubGetOpeningRequest struct {
	OrgDomain     string `json:"org_domain"`
	OpeningNumber int32  `json:"opening_number"`
}

// HubOpeningAddress is a hub-scoped view of an org address (avoids an org→hub→org import cycle).
type HubOpeningAddress struct {
	AddressID string  `json:"address_id"`
	City      string  `json:"city"`
	State     *string `json:"state,omitempty"`
	Country   string  `json:"country"`
}

// HubOpeningSalary is a hub-scoped view of a salary range.
type HubOpeningSalary struct {
	MinAmount int32  `json:"min_amount"`
	MaxAmount int32  `json:"max_amount"`
	Currency  string `json:"currency"`
}

// HubOpeningTag is a hub-scoped view of a tag.
type HubOpeningTag struct {
	TagID       string `json:"tag_id"`
	DisplayName string `json:"display_name"`
}

type HubOpeningDetail struct {
	// Opening fields
	OpeningID         string              `json:"opening_id"`
	OpeningNumber     int32               `json:"opening_number"`
	Title             string              `json:"title"`
	Description       string              `json:"description"`
	IsInternal        bool                `json:"is_internal"`
	Status            string              `json:"status"`
	EmploymentType    EmploymentType      `json:"employment_type"`
	WorkLocationType  WorkLocationType    `json:"work_location_type"`
	Addresses         []HubOpeningAddress `json:"addresses"`
	MinYOE            *int32              `json:"min_yoe,omitempty"`
	MaxYOE            *int32              `json:"max_yoe,omitempty"`
	Salary            *HubOpeningSalary   `json:"salary,omitempty"`
	NumberOfPositions int32               `json:"number_of_positions"`
	FilledPositions   int32               `json:"filled_positions"`
	Tags              []HubOpeningTag     `json:"tags"`
	FirstPublishedAt  *string             `json:"first_published_at,omitempty"`

	// Viewer-aware fields
	ColleagueCountHere int32 `json:"colleague_count_here"`
	ViewerCanRefer     bool  `json:"viewer_can_refer"`
	ViewerHasApplied   bool  `json:"viewer_has_applied"`
}

type ListColleaguesAtEmployerRequest struct {
	OrgDomain     string  `json:"org_domain"`
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

type ColleagueAtEmployer struct {
	Handle                string `json:"handle"`
	DisplayName           string `json:"display_name"`
	SharedDomain          string `json:"shared_domain"`
	OverlapStartYear      int32  `json:"overlap_start_year"`
	OverlapEndYear        int32  `json:"overlap_end_year"`
	CurrentEmployerDomain string `json:"current_employer_domain"`
	CurrentStintStartedAt string `json:"current_stint_started_at"`
}

type ListColleaguesAtEmployerResponse struct {
	Colleagues        []ColleagueAtEmployer `json:"colleagues"`
	NextPaginationKey *string               `json:"next_pagination_key,omitempty"`
}

type NetworkOpportunity struct {
	OrgDomain                    string           `json:"org_domain"`
	OrgName                      string           `json:"org_name"`
	ColleagueCount               int32            `json:"colleague_count"`
	MostRecentColleagueStartedAt string           `json:"most_recent_colleague_started_at"`
	Openings                     []HubOpeningCard `json:"openings"`
}

type ListNetworkOpportunitiesResponse struct {
	Opportunities []NetworkOpportunity `json:"opportunities"`
}

// Validation functions
func (r *HubListOpeningsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{
			Field:   "limit",
			Message: "must be between 1 and 100",
		})
	}

	if r.FilterMinYOE != nil && *r.FilterMinYOE < 0 {
		errs = append(errs, common.ValidationError{
			Field:   "filter_min_yoe",
			Message: "must be non-negative",
		})
	}

	return errs
}

func (r *HubGetOpeningRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.OrgDomain == "" {
		errs = append(errs, common.ValidationError{
			Field:   "org_domain",
			Message: "is required",
		})
	}

	if r.OpeningNumber < 1 {
		errs = append(errs, common.ValidationError{
			Field:   "opening_number",
			Message: "must be positive",
		})
	}

	return errs
}

func (r *ListColleaguesAtEmployerRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.OrgDomain == "" {
		errs = append(errs, common.ValidationError{
			Field:   "org_domain",
			Message: "is required",
		})
	}

	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{
			Field:   "limit",
			Message: "must be between 1 and 100",
		})
	}

	return errs
}
