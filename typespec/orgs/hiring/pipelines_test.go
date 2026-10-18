package hiring

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func stages(count int) []PipelineStageDefinition {
	result := make([]PipelineStageDefinition, count)
	for index := range result {
		result[index] = PipelineStageDefinition{Name: "Stage", Kind: ReviewStage}
	}
	return result
}

func TestCreatePipelineTemplateNormalizesWithoutMutatingTheCaller(t *testing.T) {
	t.Parallel()
	original := []PipelineStageDefinition{{Name: "  Screen ", Kind: ReviewStage}}
	request := CreatePipelineTemplateRequest{Name: "  Hiring  ", Stages: original}
	request.Normalize()
	if request.Name != "Hiring" || request.Stages[0].Name != "Screen" {
		t.Fatalf("unexpected normalized request: %+v", request)
	}
	if original[0].Name != "  Screen " {
		t.Fatal("normalization mutated the caller's stages")
	}
}

func TestPipelineTemplateRequestValidation(t *testing.T) {
	t.Parallel()
	const id = PipelineTemplateID("01900000-0000-7000-8000-000000000000")
	tests := []struct {
		name string
		got  []string
		want []string
	}{
		{"valid", CreatePipelineTemplateRequest{Name: "A", Stages: stages(1)}.Validate(), []string{}},
		{"fifteen stages", CreatePipelineTemplateRequest{Name: "A", Stages: stages(15)}.Validate(), []string{}},
		{"sixteen stages", CreatePipelineTemplateRequest{Name: "A", Stages: stages(16)}.Validate(), []string{"stages"}},
		{"no stages", CreatePipelineTemplateRequest{Name: "A"}.Validate(), []string{"stages"}},
		{"name of 100 code points", CreatePipelineTemplateRequest{Name: PipelineName(strings.Repeat("é", 100)), Stages: stages(1)}.Validate(), []string{}},
		{"name of 101 code points", CreatePipelineTemplateRequest{Name: PipelineName(strings.Repeat("é", 101)), Stages: stages(1)}.Validate(), []string{"name"}},
		{"blank name", CreatePipelineTemplateRequest{Name: "", Stages: stages(1)}.Validate(), []string{"name"}},
		{"untrimmed name", CreatePipelineTemplateRequest{Name: " A", Stages: stages(1)}.Validate(), []string{"name"}},
		{"bad stage", CreatePipelineTemplateRequest{Name: "A", Stages: []PipelineStageDefinition{
			{Name: "", Kind: ReviewStage}, {Name: "B", Kind: "mystery"},
		}}.Validate(), []string{"stages.0.name", "stages.1.kind"}},
		{"update valid", UpdatePipelineTemplateRequest{TemplateID: id, Name: "A", Stages: stages(2)}.Validate(), []string{}},
		{"update bad id", UpdatePipelineTemplateRequest{TemplateID: "x", Name: "A", Stages: stages(1)}.Validate(), []string{"template_id"}},
		{"update uppercase id", UpdatePipelineTemplateRequest{TemplateID: "01900000-0000-7000-8000-00000000000A", Name: "A", Stages: stages(1)}.Validate(), []string{"template_id"}},
		{"delete bad id", DeletePipelineTemplateRequest{}.Validate(), []string{"template_id"}},
		{"delete valid", DeletePipelineTemplateRequest{TemplateID: id}.Validate(), []string{}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.got, test.want) {
				t.Fatalf("fields = %v, want %v", test.got, test.want)
			}
		})
	}
}

func TestListPipelineTemplatesValidation(t *testing.T) {
	t.Parallel()
	if got := (ListPipelineTemplatesRequest{}).Validate(); len(got) != 0 {
		t.Fatalf("empty request fields = %v", got)
	}
	if got := (ListPipelineTemplatesRequest{}).EffectiveLimit(); got != 50 {
		t.Fatalf("default limit = %d, want 50", got)
	}
	zero := common.PageSize(0)
	empty := common.PaginationKey("")
	got := ListPipelineTemplatesRequest{Limit: &zero, PaginationKey: &empty}.Validate()
	if !slices.Equal(got, []string{"pagination_key", "limit"}) {
		t.Fatalf("fields = %v", got)
	}
}
