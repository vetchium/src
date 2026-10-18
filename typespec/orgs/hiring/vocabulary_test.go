package hiring

import (
	"slices"
	"testing"
)

func TestStageKindsAndCheckTypes(t *testing.T) {
	t.Parallel()
	wantKinds := []StageKind{
		"review", "assessment", "interview", "background_check",
	}
	if got := StageKinds(); !slices.Equal(got, wantKinds) {
		t.Fatalf("StageKinds() = %v, want %v", got, wantKinds)
	}
	wantChecks := []CheckType{
		"identity", "education", "employment", "criminal", "address",
		"credit", "drug",
	}
	if got := CheckTypes(); !slices.Equal(got, wantChecks) {
		t.Fatalf("CheckTypes() = %v, want %v", got, wantChecks)
	}
}

func TestCatalogsAreCopies(t *testing.T) {
	t.Parallel()
	StageKinds()[0] = "changed"
	CheckTypes()[0] = "changed"
	if StageKinds()[0] != ReviewStage || CheckTypes()[0] != IdentityCheck {
		t.Fatal("caller mutated a vocabulary")
	}
}

func TestIsStageKindAndIsCheckType(t *testing.T) {
	t.Parallel()
	for _, kind := range StageKinds() {
		if !IsStageKind(kind) {
			t.Fatalf("defined stage kind %q rejected", kind)
		}
	}
	for _, check := range CheckTypes() {
		if !IsCheckType(check) {
			t.Fatalf("defined check type %q rejected", check)
		}
	}
	if IsStageKind("") || IsStageKind("sourcing") || IsStageKind("Review") {
		t.Fatal("unknown stage kind accepted")
	}
	if IsCheckType("") || IsCheckType("drugs") || IsCheckType("Drug") {
		t.Fatal("unknown check type accepted")
	}
}
