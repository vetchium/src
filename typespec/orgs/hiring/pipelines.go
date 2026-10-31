package hiring

import (
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
)

const (
	// MaxPipelineStages bounds one pipeline, template or Opening.
	MaxPipelineStages = 15
	// MaxPipelineTemplates bounds the templates one Org keeps.
	MaxPipelineTemplates = 50
	maxPipelineName      = 100
)

type PipelineName string
type PipelineTemplateID string
type PipelineStageID string

var uuidPattern = regexp.MustCompile(
	`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
)

// IsPipelineTemplateID accepts the lowercase form the API returns.
func IsPipelineTemplateID(value PipelineTemplateID) bool {
	return uuidPattern.MatchString(string(value))
}

// IsPipelineStageID accepts the lowercase form the API returns.
func IsPipelineStageID(value PipelineStageID) bool {
	return uuidPattern.MatchString(string(value))
}

// NormalizePipelineName trims surrounding whitespace.
func NormalizePipelineName(value PipelineName) PipelineName {
	return PipelineName(strings.TrimSpace(string(value)))
}

// IsPipelineName reports a trimmed name of 1 to 100 code points.
func IsPipelineName(value PipelineName) bool {
	length := utf8.RuneCountInString(string(value))
	return length >= 1 && length <= maxPipelineName &&
		value == NormalizePipelineName(value)
}

// FeedbackCriterionType is how an interviewer answers a criterion
// (HP-FRM-001).
type FeedbackCriterionType string

const (
	CriterionRating FeedbackCriterionType = "rating"
	CriterionYesNo  FeedbackCriterionType = "yes_no"
	CriterionText   FeedbackCriterionType = "text"
)

const (
	MaxFeedbackCriteria  = 10
	maxFeedbackCriterion = 500
)

func IsFeedbackCriterionType(value FeedbackCriterionType) bool {
	switch value {
	case CriterionRating, CriterionYesNo, CriterionText:
		return true
	}
	return false
}

type FeedbackCriterionID string

// IsFeedbackCriterionID accepts the lowercase form the API returns.
func IsFeedbackCriterionID(value FeedbackCriterionID) bool {
	return uuidPattern.MatchString(string(value))
}

// FeedbackCriterion is one criterion of an interview stage's feedback form;
// a nil ID is a new criterion.
type FeedbackCriterion struct {
	ID       *FeedbackCriterionID  `json:"id,omitempty"`
	Text     string                `json:"text"`
	Type     FeedbackCriterionType `json:"type"`
	Required bool                  `json:"required"`
}

// NormalizeFeedbackForm returns a trimmed copy; nil stays nil.
func NormalizeFeedbackForm(form []FeedbackCriterion) []FeedbackCriterion {
	if form == nil {
		return nil
	}
	normalized := make([]FeedbackCriterion, len(form))
	for index, criterion := range form {
		criterion.Text = strings.TrimSpace(criterion.Text)
		normalized[index] = criterion
	}
	return normalized
}

// ValidateFeedbackForm reports invalid fields under prefix (the form's own
// path). Only an interview stage has a form. seen collects ids across the
// pipeline, so an id repeated in any stage is refused.
func ValidateFeedbackForm(
	prefix string, kind StageKind, form []FeedbackCriterion,
	seen map[FeedbackCriterionID]bool,
) []string {
	if len(form) == 0 {
		return nil
	}
	if kind != InterviewStage || len(form) > MaxFeedbackCriteria {
		return []string{prefix}
	}
	var fields []string
	for index, criterion := range form {
		path := fmt.Sprintf("%s.%d", prefix, index)
		if criterion.ID != nil {
			if !IsFeedbackCriterionID(*criterion.ID) || seen[*criterion.ID] {
				fields = append(fields, path+".id")
			}
			seen[*criterion.ID] = true
		}
		length := utf8.RuneCountInString(criterion.Text)
		if length < 1 || length > maxFeedbackCriterion ||
			criterion.Text != strings.TrimSpace(criterion.Text) {
			fields = append(fields, path+".text")
		}
		if !IsFeedbackCriterionType(criterion.Type) {
			fields = append(fields, path+".type")
		}
	}
	return fields
}

// PipelineStageDefinition is a stage as a template or a new Opening
// describes it.
type PipelineStageDefinition struct {
	Name PipelineName `json:"name"`
	Kind StageKind    `json:"kind"`
	// FeedbackForm is nil for a stage that is not an interview.
	FeedbackForm []FeedbackCriterion `json:"feedback_form,omitzero"`
}

// PipelineStage is a stage of an Opening's pipeline.
type PipelineStage struct {
	ID           PipelineStageID     `json:"id"`
	Name         PipelineName        `json:"name"`
	Kind         StageKind           `json:"kind"`
	FeedbackForm []FeedbackCriterion `json:"feedback_form,omitzero"`
}

// NormalizeStageDefinitions returns a normalized copy, leaving the caller's
// slice untouched.
func NormalizeStageDefinitions(
	stages []PipelineStageDefinition,
) []PipelineStageDefinition {
	if stages == nil {
		return nil
	}
	normalized := make([]PipelineStageDefinition, len(stages))
	for index, stage := range stages {
		normalized[index] = PipelineStageDefinition{
			Name: NormalizePipelineName(stage.Name), Kind: stage.Kind,
			FeedbackForm: NormalizeFeedbackForm(stage.FeedbackForm),
		}
	}
	return normalized
}

// ValidateStageDefinitions reports invalid fields under prefix.
func ValidateStageDefinitions(
	prefix string, stages []PipelineStageDefinition,
) []string {
	if len(stages) < 1 || len(stages) > MaxPipelineStages {
		return []string{prefix}
	}
	fields := []string{}
	seen := map[FeedbackCriterionID]bool{}
	for index, stage := range stages {
		if !IsPipelineName(stage.Name) {
			fields = append(fields, fmt.Sprintf("%s.%d.name", prefix, index))
		}
		if !IsStageKind(stage.Kind) {
			fields = append(fields, fmt.Sprintf("%s.%d.kind", prefix, index))
		}
		fields = append(fields, ValidateFeedbackForm(
			fmt.Sprintf("%s.%d.feedback_form", prefix, index), stage.Kind,
			stage.FeedbackForm, seen)...)
	}
	return fields
}

type PipelineTemplate struct {
	ID        PipelineTemplateID        `json:"id"`
	Name      PipelineName              `json:"name"`
	Stages    []PipelineStageDefinition `json:"stages"`
	CreatedAt time.Time                 `json:"created_at"`
	UpdatedAt time.Time                 `json:"updated_at"`
}

type ListPipelineTemplatesRequest struct {
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *common.PageSize      `json:"limit,omitempty"`
}

func (r *ListPipelineTemplatesRequest) Normalize() {}

func (r ListPipelineTemplatesRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListPipelineTemplatesRequest) Validate() []string {
	fields := []string{}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && !common.IsPageSize(*r.Limit) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListPipelineTemplatesResponse struct {
	Templates         []PipelineTemplate    `json:"templates"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type CreatePipelineTemplateRequest struct {
	Name   PipelineName              `json:"name"`
	Stages []PipelineStageDefinition `json:"stages"`
}

func (r *CreatePipelineTemplateRequest) Normalize() {
	r.Name = NormalizePipelineName(r.Name)
	r.Stages = NormalizeStageDefinitions(r.Stages)
}

func (r CreatePipelineTemplateRequest) Validate() []string {
	fields := []string{}
	if !IsPipelineName(r.Name) {
		fields = append(fields, "name")
	}
	return append(fields, ValidateStageDefinitions("stages", r.Stages)...)
}

type UpdatePipelineTemplateRequest struct {
	TemplateID PipelineTemplateID        `json:"template_id"`
	Name       PipelineName              `json:"name"`
	Stages     []PipelineStageDefinition `json:"stages"`
}

func (r *UpdatePipelineTemplateRequest) Normalize() {
	r.Name = NormalizePipelineName(r.Name)
	r.Stages = NormalizeStageDefinitions(r.Stages)
}

func (r UpdatePipelineTemplateRequest) Validate() []string {
	fields := []string{}
	if !IsPipelineTemplateID(r.TemplateID) {
		fields = append(fields, "template_id")
	}
	if !IsPipelineName(r.Name) {
		fields = append(fields, "name")
	}
	return append(fields, ValidateStageDefinitions("stages", r.Stages)...)
}

type DeletePipelineTemplateRequest struct {
	TemplateID PipelineTemplateID `json:"template_id"`
}

func (r *DeletePipelineTemplateRequest) Normalize() {}

func (r DeletePipelineTemplateRequest) Validate() []string {
	if !IsPipelineTemplateID(r.TemplateID) {
		return []string{"template_id"}
	}
	return []string{}
}
