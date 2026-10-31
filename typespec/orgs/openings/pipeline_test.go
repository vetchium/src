package openings

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/hiring"
)

var (
	commonContent = common.OpeningContent{}
	templateBad   = hiring.PipelineTemplateID("nope")
)

func TestReplaceOpeningPipelineNormalizesWithoutMutatingTheCaller(t *testing.T) {
	t.Parallel()
	id := hiring.PipelineStageID("01900000-0000-7000-8000-000000000000")
	original := []PipelineStageInput{{ID: &id, Name: " Screen ", Kind: hiring.ReviewStage}}
	request := ReplaceOpeningPipelineRequest{OpeningNumber: 1, Version: 1, Stages: original}
	request.Normalize()
	if request.Stages[0].Name != "Screen" || *request.Stages[0].ID != id {
		t.Fatalf("unexpected normalized request: %+v", request)
	}
	if original[0].Name != " Screen " {
		t.Fatal("normalization mutated the caller's stages")
	}
	form := ReplaceOpeningPipelineRequest{Stages: []PipelineStageInput{{
		Name: "Panel", Kind: hiring.InterviewStage,
		FeedbackForm: []hiring.FeedbackCriterion{{Text: " Depth ", Type: hiring.CriterionText}},
	}}}
	form.Normalize()
	if form.Stages[0].FeedbackForm[0].Text != "Depth" {
		t.Fatalf("form not normalized: %+v", form.Stages[0].FeedbackForm)
	}
}

func TestReplaceOpeningPipelineValidation(t *testing.T) {
	t.Parallel()
	first := hiring.PipelineStageID("01900000-0000-7000-8000-000000000001")
	bad := hiring.PipelineStageID("nope")
	criterion := hiring.FeedbackCriterionID("01900000-0000-7000-8000-000000000002")
	stage := PipelineStageInput{Name: "Screen", Kind: hiring.ReviewStage}
	many := make([]PipelineStageInput, 16)
	for index := range many {
		many[index] = stage
	}
	tests := []struct {
		name string
		got  []string
		want []string
	}{
		{"valid", ReplaceOpeningPipelineRequest{OpeningNumber: 1, Version: 1, Stages: []PipelineStageInput{stage}}.Validate(), []string{}},
		{"number and version", ReplaceOpeningPipelineRequest{Stages: []PipelineStageInput{stage}}.Validate(), []string{"opening_number", "version"}},
		{"no stages", ReplaceOpeningPipelineRequest{OpeningNumber: 1, Version: 1}.Validate(), []string{"stages"}},
		{"sixteen stages", ReplaceOpeningPipelineRequest{OpeningNumber: 1, Version: 1, Stages: many}.Validate(), []string{"stages"}},
		{"fifteen stages", ReplaceOpeningPipelineRequest{OpeningNumber: 1, Version: 1, Stages: many[:15]}.Validate(), []string{}},
		{"malformed and repeated ids", ReplaceOpeningPipelineRequest{OpeningNumber: 1, Version: 1, Stages: []PipelineStageInput{
			{ID: &first, Name: "A", Kind: hiring.ReviewStage},
			{ID: &first, Name: "B", Kind: hiring.ReviewStage},
			{ID: &bad, Name: "C", Kind: hiring.ReviewStage},
		}}.Validate(), []string{"stages.1.id", "stages.2.id"}},
		{"bad name and kind", ReplaceOpeningPipelineRequest{OpeningNumber: 1, Version: 1, Stages: []PipelineStageInput{
			{Name: "", Kind: "mystery"},
		}}.Validate(), []string{"stages.0.name", "stages.0.kind"}},
		{"forms on interview stages only, ids unique across stages", ReplaceOpeningPipelineRequest{OpeningNumber: 1, Version: 1, Stages: []PipelineStageInput{
			{Name: "Panel", Kind: hiring.InterviewStage, FeedbackForm: []hiring.FeedbackCriterion{{ID: &criterion, Text: "Depth", Type: hiring.CriterionRating}}},
			{Name: "Final", Kind: hiring.InterviewStage, FeedbackForm: []hiring.FeedbackCriterion{{ID: &criterion, Text: "Fit", Type: hiring.CriterionYesNo}}},
			{Name: "Screen", Kind: hiring.ReviewStage, FeedbackForm: []hiring.FeedbackCriterion{{Text: "Fit", Type: hiring.CriterionYesNo}}},
		}}.Validate(), []string{"stages.1.feedback_form.0.id", "stages.2.feedback_form"}},
		{"get number", GetOpeningPipelineRequest{}.Validate(), []string{"opening_number"}},
		{"create template id", CreateOpeningRequest{Content: &commonContent, TeamMemberEmails: []common.EmailAddress{}, PipelineTemplateID: &templateBad}.Validate(), []string{"pipeline_template_id"}},
		{"duplicate template id", DuplicateOpeningRequest{OpeningNumber: 1, PipelineTemplateID: &templateBad}.Validate(), []string{"pipeline_template_id"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.got, test.want) {
				t.Fatalf("fields = %v, want %v", test.got, test.want)
			}
		})
	}
}
