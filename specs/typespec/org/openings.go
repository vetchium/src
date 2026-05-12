package org

import (
	"fmt"

	"vetchium-api-server.typespec/common"
)

const (
	titleMax         = 200
	descriptionMax   = 10000
	internalNotesMax = 2000
	rejectionNoteMax = 2000
	addressIDsMin    = 1
	addressIDsMax    = 10
	hiringTeamMax    = 10
	watchersMax      = 25
	tagIDsMax        = 20
	yoeMin           = 0
	yoeMax           = 100
	positionsMax     = 100
)

// Error messages
const (
	errTitleRequired             = "title is required"
	errTitleTooLong              = "title must be at most 200 characters"
	errDescriptionRequired       = "description is required"
	errDescriptionTooLong        = "description must be at most 10000 characters"
	errEmploymentTypeRequired    = "employment_type is required"
	errWorkLocationTypeRequired  = "work_location_type is required"
	errAddressIDsRequired        = "address_ids is required"
	errNumberOfPositionsRequired = "number_of_positions is required"
	errHiringManagerRequired     = "hiring_manager_email_address is required"
	errRecruiterRequired         = "recruiter_email_address is required"
)

type OpeningStatus string

const (
	OpeningStatusDraft         OpeningStatus = "draft"
	OpeningStatusPendingReview OpeningStatus = "pending_review"
	OpeningStatusPublished     OpeningStatus = "published"
	OpeningStatusPaused        OpeningStatus = "paused"
	OpeningStatusExpired       OpeningStatus = "expired"
	OpeningStatusClosed        OpeningStatus = "closed"
	OpeningStatusArchived      OpeningStatus = "archived"
)

type EmploymentType string

const (
	EmploymentTypeFullTime   EmploymentType = "full_time"
	EmploymentTypePartTime   EmploymentType = "part_time"
	EmploymentTypeContract   EmploymentType = "contract"
	EmploymentTypeInternship EmploymentType = "internship"
)

type WorkLocationType string

const (
	WorkLocationTypeRemote WorkLocationType = "remote"
	WorkLocationTypeOnSite WorkLocationType = "on_site"
	WorkLocationTypeHybrid WorkLocationType = "hybrid"
)

type EducationLevel string

const (
	EducationLevelNotRequired EducationLevel = "not_required"
	EducationLevelBachelor    EducationLevel = "bachelor"
	EducationLevelMaster      EducationLevel = "master"
	EducationLevelDoctorate   EducationLevel = "doctorate"
)

type Salary struct {
	MinAmount float64 `json:"min_amount"`
	MaxAmount float64 `json:"max_amount"`
	Currency  string  `json:"currency"`
}

type CreateOpeningRequest struct {
	Title                          string           `json:"title"`
	Description                    string           `json:"description"`
	IsInternal                     bool             `json:"is_internal"`
	EmploymentType                 EmploymentType   `json:"employment_type"`
	WorkLocationType               WorkLocationType `json:"work_location_type"`
	AddressIDs                     []string         `json:"address_ids"`
	MinYOE                         *int32           `json:"min_yoe,omitempty"`
	MaxYOE                         *int32           `json:"max_yoe,omitempty"`
	MinEducationLevel              *EducationLevel  `json:"min_education_level,omitempty"`
	Salary                         *Salary          `json:"salary,omitempty"`
	NumberOfPositions              int32            `json:"number_of_positions"`
	HiringManagerEmailAddress      string           `json:"hiring_manager_email_address"`
	RecruiterEmailAddress          string           `json:"recruiter_email_address"`
	HiringTeamMemberEmailAddresses []string         `json:"hiring_team_member_email_addresses,omitempty"`
	WatcherEmailAddresses          []string         `json:"watcher_email_addresses,omitempty"`
	CostCenterID                   *string          `json:"cost_center_id,omitempty"`
	TagIDs                         []string         `json:"tag_ids,omitempty"`
	InternalNotes                  *string          `json:"internal_notes,omitempty"`
}

type CreateOpeningResponse struct {
	OpeningID     string `json:"opening_id"`
	OpeningNumber int32  `json:"opening_number"`
}

type OpeningSummary struct {
	OpeningID         string            `json:"opening_id"`
	OpeningNumber     int32             `json:"opening_number"`
	Title             string            `json:"title"`
	IsInternal        bool              `json:"is_internal"`
	Status            OpeningStatus     `json:"status"`
	EmploymentType    EmploymentType    `json:"employment_type"`
	WorkLocationType  WorkLocationType  `json:"work_location_type"`
	NumberOfPositions int32             `json:"number_of_positions"`
	FilledPositions   int32             `json:"filled_positions"`
	HiringManager     map[string]string `json:"hiring_manager"`
	Recruiter         map[string]string `json:"recruiter"`
	CreatedAt         string            `json:"created_at"`
	FirstPublishedAt  *string           `json:"first_published_at,omitempty"`
}

type Opening struct {
	OpeningID         string                 `json:"opening_id"`
	OpeningNumber     int32                  `json:"opening_number"`
	Title             string                 `json:"title"`
	Description       string                 `json:"description"`
	IsInternal        bool                   `json:"is_internal"`
	Status            OpeningStatus          `json:"status"`
	EmploymentType    EmploymentType         `json:"employment_type"`
	WorkLocationType  WorkLocationType       `json:"work_location_type"`
	Addresses         []OrgAddress           `json:"addresses"`
	MinYOE            *int32                 `json:"min_yoe,omitempty"`
	MaxYOE            *int32                 `json:"max_yoe,omitempty"`
	MinEducationLevel *EducationLevel        `json:"min_education_level,omitempty"`
	Salary            *Salary                `json:"salary,omitempty"`
	NumberOfPositions int32                  `json:"number_of_positions"`
	FilledPositions   int32                  `json:"filled_positions"`
	HiringManager     map[string]string      `json:"hiring_manager"`
	Recruiter         map[string]string      `json:"recruiter"`
	SubmittedBy       map[string]string      `json:"submitted_by,omitempty"`
	HiringTeamMembers []map[string]string    `json:"hiring_team_members"`
	Watchers          []map[string]string    `json:"watchers"`
	CostCenter        map[string]interface{} `json:"cost_center,omitempty"`
	Tags              []map[string]string    `json:"tags"`
	InternalNotes     *string                `json:"internal_notes,omitempty"`
	RejectionNote     *string                `json:"rejection_note,omitempty"`
	CreatedAt         string                 `json:"created_at"`
	UpdatedAt         string                 `json:"updated_at"`
	FirstPublishedAt  *string                `json:"first_published_at,omitempty"`
}

type UpdateOpeningRequest struct {
	OpeningNumber                  int32            `json:"opening_number"`
	Title                          string           `json:"title"`
	Description                    string           `json:"description"`
	EmploymentType                 EmploymentType   `json:"employment_type"`
	WorkLocationType               WorkLocationType `json:"work_location_type"`
	AddressIDs                     []string         `json:"address_ids"`
	MinYOE                         *int32           `json:"min_yoe,omitempty"`
	MaxYOE                         *int32           `json:"max_yoe,omitempty"`
	MinEducationLevel              *EducationLevel  `json:"min_education_level,omitempty"`
	Salary                         *Salary          `json:"salary,omitempty"`
	NumberOfPositions              int32            `json:"number_of_positions"`
	HiringManagerEmailAddress      string           `json:"hiring_manager_email_address"`
	RecruiterEmailAddress          string           `json:"recruiter_email_address"`
	HiringTeamMemberEmailAddresses []string         `json:"hiring_team_member_email_addresses,omitempty"`
	WatcherEmailAddresses          []string         `json:"watcher_email_addresses,omitempty"`
	CostCenterID                   *string          `json:"cost_center_id,omitempty"`
	TagIDs                         []string         `json:"tag_ids,omitempty"`
	InternalNotes                  *string          `json:"internal_notes,omitempty"`
}

type ListOpeningsRequest struct {
	FilterStatus                    []OpeningStatus `json:"filter_status,omitempty"`
	FilterIsInternal                *bool           `json:"filter_is_internal,omitempty"`
	FilterHiringManagerEmailAddress *string         `json:"filter_hiring_manager_email_address,omitempty"`
	FilterRecruiterEmailAddress     *string         `json:"filter_recruiter_email_address,omitempty"`
	FilterTagIDs                    []string        `json:"filter_tag_ids,omitempty"`
	FilterTitlePrefix               *string         `json:"filter_title_prefix,omitempty"`
	PaginationKey                   *string         `json:"pagination_key,omitempty"`
	Limit                           *int32          `json:"limit,omitempty"`
}

type ListOpeningsResponse struct {
	Openings          []OpeningSummary `json:"openings"`
	NextPaginationKey *string          `json:"next_pagination_key,omitempty"`
}

type OpeningNumberRequest struct {
	OpeningNumber int32 `json:"opening_number"`
}

type RejectOpeningRequest struct {
	OpeningNumber int32  `json:"opening_number"`
	RejectionNote string `json:"rejection_note"`
}

func (r CreateOpeningRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Title == "" {
		errs = append(errs, common.NewValidationError("title", fmt.Errorf(errTitleRequired)))
	} else if len(r.Title) > titleMax {
		errs = append(errs, common.NewValidationError("title", fmt.Errorf(errTitleTooLong)))
	}
	if r.Description == "" {
		errs = append(errs, common.NewValidationError("description", fmt.Errorf(errDescriptionRequired)))
	} else if len(r.Description) > descriptionMax {
		errs = append(errs, common.NewValidationError("description", fmt.Errorf(errDescriptionTooLong)))
	}
	if r.EmploymentType == "" {
		errs = append(errs, common.NewValidationError("employment_type", fmt.Errorf(errEmploymentTypeRequired)))
	}
	if r.WorkLocationType == "" {
		errs = append(errs, common.NewValidationError("work_location_type", fmt.Errorf(errWorkLocationTypeRequired)))
	}
	if len(r.AddressIDs) == 0 {
		errs = append(errs, common.NewValidationError("address_ids", fmt.Errorf(errAddressIDsRequired)))
	}
	if r.NumberOfPositions < 1 {
		errs = append(errs, common.NewValidationError("number_of_positions", fmt.Errorf(errNumberOfPositionsRequired)))
	}
	if r.HiringManagerEmailAddress == "" {
		errs = append(errs, common.NewValidationError("hiring_manager_email_address", fmt.Errorf(errHiringManagerRequired)))
	}
	if r.RecruiterEmailAddress == "" {
		errs = append(errs, common.NewValidationError("recruiter_email_address", fmt.Errorf(errRecruiterRequired)))
	}
	return errs
}

func (r UpdateOpeningRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Title == "" {
		errs = append(errs, common.NewValidationError("title", fmt.Errorf(errTitleRequired)))
	} else if len(r.Title) > titleMax {
		errs = append(errs, common.NewValidationError("title", fmt.Errorf(errTitleTooLong)))
	}
	if r.Description == "" {
		errs = append(errs, common.NewValidationError("description", fmt.Errorf(errDescriptionRequired)))
	} else if len(r.Description) > descriptionMax {
		errs = append(errs, common.NewValidationError("description", fmt.Errorf(errDescriptionTooLong)))
	}
	if r.EmploymentType == "" {
		errs = append(errs, common.NewValidationError("employment_type", fmt.Errorf(errEmploymentTypeRequired)))
	}
	if r.WorkLocationType == "" {
		errs = append(errs, common.NewValidationError("work_location_type", fmt.Errorf(errWorkLocationTypeRequired)))
	}
	if len(r.AddressIDs) == 0 {
		errs = append(errs, common.NewValidationError("address_ids", fmt.Errorf(errAddressIDsRequired)))
	}
	if r.NumberOfPositions < 1 {
		errs = append(errs, common.NewValidationError("number_of_positions", fmt.Errorf(errNumberOfPositionsRequired)))
	}
	if r.HiringManagerEmailAddress == "" {
		errs = append(errs, common.NewValidationError("hiring_manager_email_address", fmt.Errorf(errHiringManagerRequired)))
	}
	if r.RecruiterEmailAddress == "" {
		errs = append(errs, common.NewValidationError("recruiter_email_address", fmt.Errorf(errRecruiterRequired)))
	}
	return errs
}

func (r RejectOpeningRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.RejectionNote == "" {
		errs = append(errs, common.NewValidationError("rejection_note", fmt.Errorf("rejection_note is required")))
	} else if len(r.RejectionNote) > rejectionNoteMax {
		errs = append(errs, common.NewValidationError("rejection_note", fmt.Errorf("rejection_note must be at most 2000 characters")))
	}
	return errs
}
