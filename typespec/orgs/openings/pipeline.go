package openings

import (
	"fmt"

	"github.com/vetchium/src/typespec/orgs/hiring"
)

// PipelineStageInput is a stage of a replacement pipeline. A nil ID adds a
// stage; an ID keeps, renames, or moves the stage that has it.
type PipelineStageInput struct {
	ID   *hiring.PipelineStageID `json:"id,omitempty"`
	Name hiring.PipelineName     `json:"name"`
	Kind hiring.StageKind        `json:"kind"`
}

type OpeningPipeline struct {
	OpeningNumber OpeningNumber          `json:"opening_number"`
	Version       OpeningVersion         `json:"version"`
	Stages        []hiring.PipelineStage `json:"stages"`
}

type GetOpeningPipelineRequest struct {
	OpeningNumber OpeningNumber `json:"opening_number"`
}

func (r *GetOpeningPipelineRequest) Normalize() {}
func (r GetOpeningPipelineRequest) Validate() []string {
	if !validNumber(r.OpeningNumber) {
		return []string{"opening_number"}
	}
	return []string{}
}

type ReplaceOpeningPipelineRequest struct {
	OpeningNumber OpeningNumber        `json:"opening_number"`
	Version       OpeningVersion       `json:"version"`
	Stages        []PipelineStageInput `json:"stages"`
}

func (r *ReplaceOpeningPipelineRequest) Normalize() {
	if r.Stages == nil {
		return
	}
	normalized := make([]PipelineStageInput, len(r.Stages))
	for index, stage := range r.Stages {
		normalized[index] = PipelineStageInput{
			ID: stage.ID, Name: hiring.NormalizePipelineName(stage.Name),
			Kind: stage.Kind,
		}
	}
	r.Stages = normalized
}

func (r ReplaceOpeningPipelineRequest) Validate() []string {
	fields := []string{}
	if !validNumber(r.OpeningNumber) {
		fields = append(fields, "opening_number")
	}
	if !validVersion(r.Version) {
		fields = append(fields, "version")
	}
	if len(r.Stages) < 1 || len(r.Stages) > hiring.MaxPipelineStages {
		return append(fields, "stages")
	}
	seen := make(map[hiring.PipelineStageID]bool, len(r.Stages))
	for index, stage := range r.Stages {
		if stage.ID != nil {
			if !hiring.IsPipelineStageID(*stage.ID) || seen[*stage.ID] {
				fields = append(fields, fmt.Sprintf("stages.%d.id", index))
			}
			seen[*stage.ID] = true
		}
		if !hiring.IsPipelineName(stage.Name) {
			fields = append(fields, fmt.Sprintf("stages.%d.name", index))
		}
		if !hiring.IsStageKind(stage.Kind) {
			fields = append(fields, fmt.Sprintf("stages.%d.kind", index))
		}
	}
	return fields
}
