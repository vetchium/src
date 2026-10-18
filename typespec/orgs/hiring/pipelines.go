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

// PipelineStageDefinition is a stage as a template or a new Opening
// describes it.
type PipelineStageDefinition struct {
	Name PipelineName `json:"name"`
	Kind StageKind    `json:"kind"`
}

// PipelineStage is a stage of an Opening's pipeline.
type PipelineStage struct {
	ID   PipelineStageID `json:"id"`
	Name PipelineName    `json:"name"`
	Kind StageKind       `json:"kind"`
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
	for index, stage := range stages {
		if !IsPipelineName(stage.Name) {
			fields = append(fields, fmt.Sprintf("%s.%d.name", prefix, index))
		}
		if !IsStageKind(stage.Kind) {
			fields = append(fields, fmt.Sprintf("%s.%d.kind", prefix, index))
		}
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
