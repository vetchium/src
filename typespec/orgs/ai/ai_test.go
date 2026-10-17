package ai

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestDraftOpeningRequestValidation(t *testing.T) {
	t.Parallel()
	model := AIModelOID("qwen3-1-7b")
	badModel := AIModelOID("Qwen 3")
	title := strings.Repeat("t", 201)
	cases := []struct {
		name    string
		request DraftOpeningRequest
		want    []string
	}{
		{"minimal", DraftOpeningRequest{Instruction: "Write a role"}, nil},
		{"with model", DraftOpeningRequest{ModelOID: &model, Instruction: "x"}, nil},
		{"blank instruction", DraftOpeningRequest{Instruction: "   "}, []string{"instruction"}},
		{
			"instruction at limit",
			DraftOpeningRequest{Instruction: strings.Repeat("é", MaxDraftInstructionLength)},
			nil,
		},
		{
			"instruction too long",
			DraftOpeningRequest{Instruction: strings.Repeat("é", MaxDraftInstructionLength+1)},
			[]string{"instruction"},
		},
		{"bad model", DraftOpeningRequest{ModelOID: &badModel, Instruction: "x"}, []string{"model_oid"}},
		{
			"invalid current content",
			DraftOpeningRequest{
				Instruction:    "x",
				CurrentContent: &common.OpeningContent{Title: &title},
			},
			[]string{"current_content.title"},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			request := testCase.request
			request.Normalize()
			if got := request.Validate(); !slices.Equal(got, testCase.want) {
				t.Fatalf("Validate() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestDraftOpeningNormalizeLeavesSourceUnchanged(t *testing.T) {
	t.Parallel()
	title := "  Engineer  "
	content := common.OpeningContent{Title: &title}
	request := DraftOpeningRequest{Instruction: "  x  ", CurrentContent: &content}
	request.Normalize()
	if request.Instruction != "x" || *request.CurrentContent.Title != "Engineer" {
		t.Fatalf("Normalize() = %+v", request)
	}
	if *content.Title != "  Engineer  " {
		t.Fatal("Normalize() mutated the caller's content")
	}
}

func TestSetAISettingsRequestValidation(t *testing.T) {
	t.Parallel()
	model := func(oid AIModelOID) *AIModelOID { return &oid }
	valid := AIOperationPolicy{
		Operation:     AIOperationOID(OpeningDraft),
		AllowedModels: []AIModelOID{"qwen3-1-7b", "ministral-3-3b"},
		DefaultModel:  model("qwen3-1-7b"),
	}
	terms := OrgAITermsVersion
	empty := ""
	manyModels := make([]AIModelOID, MaxAllowedModels+1)
	for i := range manyModels {
		manyModels[i] = AIModelOID("m" + strings.Repeat("a", i+1))
	}
	cases := []struct {
		name    string
		request SetAISettingsRequest
		want    []string
	}{
		{"no policies", SetAISettingsRequest{Policies: []AIOperationPolicy{}}, nil},
		{"nil policies", SetAISettingsRequest{}, []string{"policies"}},
		{
			"valid policy and terms",
			SetAISettingsRequest{Enabled: true, AcceptTermsVersion: &terms, Policies: []AIOperationPolicy{valid}},
			nil,
		},
		{"blank terms", SetAISettingsRequest{AcceptTermsVersion: &empty, Policies: []AIOperationPolicy{}}, []string{"accept_terms_version"}},
		{
			"unknown operation",
			SetAISettingsRequest{Policies: []AIOperationPolicy{{
				Operation: "org-future", AllowedModels: valid.AllowedModels, DefaultModel: valid.DefaultModel,
			}}},
			[]string{"policies.0.operation"},
		},
		{
			"duplicate operation",
			SetAISettingsRequest{Policies: []AIOperationPolicy{valid, valid}},
			[]string{"policies.1.operation"},
		},
		{
			"default not allowed",
			SetAISettingsRequest{Policies: []AIOperationPolicy{{
				Operation: valid.Operation, AllowedModels: []AIModelOID{"ministral-3-3b"}, DefaultModel: model("qwen3-1-7b"),
			}}},
			[]string{"policies.0.default_model"},
		},
		{
			"off",
			SetAISettingsRequest{Policies: []AIOperationPolicy{{
				Operation: valid.Operation, AllowedModels: []AIModelOID{},
			}}},
			nil,
		},
		{
			"off with a default",
			SetAISettingsRequest{Policies: []AIOperationPolicy{{
				Operation: valid.Operation, AllowedModels: []AIModelOID{}, DefaultModel: model("qwen3-1-7b"),
			}}},
			[]string{"policies.0.default_model"},
		},
		{
			"allowed models without a default",
			SetAISettingsRequest{Policies: []AIOperationPolicy{{
				Operation: valid.Operation, AllowedModels: valid.AllowedModels,
			}}},
			[]string{"policies.0.default_model"},
		},
		{
			"missing allowed models",
			SetAISettingsRequest{Policies: []AIOperationPolicy{{Operation: valid.Operation}}},
			[]string{"policies.0.allowed_models"},
		},
		{
			"duplicate allowed model",
			SetAISettingsRequest{Policies: []AIOperationPolicy{{
				Operation: valid.Operation, AllowedModels: []AIModelOID{"qwen3-1-7b", "qwen3-1-7b"}, DefaultModel: model("qwen3-1-7b"),
			}}},
			[]string{"policies.0.allowed_models"},
		},
		{
			"too many allowed models",
			SetAISettingsRequest{Policies: []AIOperationPolicy{{
				Operation: valid.Operation, AllowedModels: manyModels, DefaultModel: &manyModels[0],
			}}},
			[]string{"policies.0.allowed_models"},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := testCase.request.Validate(); !slices.Equal(got, testCase.want) {
				t.Fatalf("Validate() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestIdentifierValidation(t *testing.T) {
	t.Parallel()
	for _, value := range []AIModelOID{"qwen3-1-7b", "a", AIModelOID(strings.Repeat("a", 64))} {
		if !IsAIModelOID(value) {
			t.Fatalf("IsAIModelOID(%q) = false", value)
		}
	}
	for _, value := range []AIModelOID{"", "-a", "a-", "A", "a--b", "a.b", AIModelOID(strings.Repeat("a", 65))} {
		if IsAIModelOID(value) {
			t.Fatalf("IsAIModelOID(%q) = true", value)
		}
	}
	if !IsAIUsageID("0192f0c2-6a1e-7c3d-8e4f-0123456789ab") ||
		IsAIUsageID("0192F0C2-6A1E-7C3D-8E4F-0123456789AB") || IsAIUsageID("x") {
		t.Fatal("IsAIUsageID accepts only lowercase UUIDs")
	}
	if (BuyAICreditPackRequest{PackID: "credits-100k"}).Validate() != nil ||
		(BuyAICreditPackRequest{PackID: "Credits"}).Validate() == nil {
		t.Fatal("pack identifiers must be lowercase slugs")
	}
	if (GetAIOptionsRequest{Operation: OpeningDraft}).Validate() != nil ||
		(GetAIOptionsRequest{Operation: "org-future"}).Validate() == nil {
		t.Fatal("options need a defined operation")
	}
	zero := common.PageSize(0)
	if !slices.Equal((ListAIUsageRequest{Limit: &zero}).Validate(), []string{"limit"}) {
		t.Fatal("page size must be 1 to 100")
	}
}
