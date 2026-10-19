package applications

import (
	"slices"
	"strings"
	"testing"

	orgapplications "github.com/vetchium/src/typespec/orgs/applications"
)

func TestVocabulariesAreClosedAndCopied(t *testing.T) {
	t.Parallel()
	statuses := ApplicationStatuses()
	if !slices.Equal(statuses, []ApplicationStatus{
		"applied", "in_review", "interviewing", "offer", "hired",
		"not_progressing", "withdrawn",
	}) {
		t.Fatalf("statuses = %v", statuses)
	}
	statuses[0] = "changed"
	if !IsApplicationStatus(Applied) || IsApplicationStatus("changed") {
		t.Fatal("caller mutated the status set")
	}
	if !slices.Equal(PendingActionKinds(), []PendingActionKind{
		"interview_response", "background_check_consent", "offer_response",
	}) || IsPendingActionKind("sign") {
		t.Fatalf("pending actions = %v", PendingActionKinds())
	}
}

func TestApplyToOpeningRequestNormalizesWithoutMutatingTheCaller(t *testing.T) {
	t.Parallel()
	note := orgapplications.ApplicationCoverNote("  hello ")
	request := ApplyToOpeningRequest{
		Domain: " Example.COM ", OpeningNumber: 1, CoverNote: &note,
	}
	normalized := request
	normalized.Normalize()
	if normalized.Domain != "example.com" || *normalized.CoverNote != "hello" {
		t.Fatalf("normalized = %+v", normalized)
	}
	if note != "  hello " {
		t.Fatal("normalization mutated the caller's note")
	}
	blank := orgapplications.ApplicationCoverNote("  ")
	request.CoverNote = &blank
	request.Normalize()
	if request.CoverNote != nil {
		t.Fatal("a blank cover note is dropped")
	}
}

func TestApplyToOpeningRequestValidation(t *testing.T) {
	t.Parallel()
	exact := orgapplications.ApplicationCoverNote(strings.Repeat("é", 5000))
	good := ApplyToOpeningRequest{
		Domain: "example.com", OpeningNumber: 1, CoverNote: &exact,
	}
	if got := good.Validate(); len(got) != 0 {
		t.Fatalf("valid request rejected: %v", got)
	}
	long := orgapplications.ApplicationCoverNote(strings.Repeat("a", 5001))
	bad := ApplyToOpeningRequest{Domain: "not a domain", CoverNote: &long}
	want := []string{"domain", "opening_number", "cover_note"}
	if got := bad.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}

func TestApplicationReferenceAndMeshReadValidation(t *testing.T) {
	t.Parallel()
	reference := ApplicationReference{
		Domain: "Example.com", OpeningNumber: 1, ApplicationNumber: 1,
	}
	reference.Normalize()
	if got := reference.Validate(); reference.Domain != "example.com" ||
		len(got) != 0 {
		t.Fatalf("reference = %+v, fields = %v", reference, got)
	}
	if got := (ApplicationReference{}).Validate(); !slices.Equal(got,
		[]string{"domain", "opening_number", "application_number"}) {
		t.Fatalf("fields = %v", got)
	}
	read := MeshGetApplicationRequest{
		ApplicationReference: reference,
		ApplicantDID:         "01900000-0000-7000-8000-000000000001",
	}
	if got := read.Validate(); len(got) != 0 {
		t.Fatalf("valid read rejected: %v", got)
	}
	read.ApplicantDID = "01900000-0000-4000-8000-000000000001"
	if got := read.Validate(); !slices.Equal(got, []string{"applicant_did"}) {
		t.Fatalf("fields = %v", got)
	}
}

func TestListMyApplicationsRequestValidation(t *testing.T) {
	t.Parallel()
	if got := (ListMyApplicationsRequest{}).Validate(); len(got) != 0 {
		t.Fatalf("default request rejected: %v", got)
	}
	for _, limit := range []MyApplicationPageSize{0, 51} {
		request := ListMyApplicationsRequest{Limit: &limit}
		if got := request.Validate(); !slices.Equal(got, []string{"limit"}) {
			t.Errorf("limit %d: fields = %v", limit, got)
		}
	}
	fifty := MyApplicationPageSize(50)
	if got := (ListMyApplicationsRequest{Limit: &fifty}).EffectiveLimit(); got != 50 {
		t.Fatalf("limit = %d", got)
	}
}

func TestMyApplicationValidity(t *testing.T) {
	t.Parallel()
	application := MyApplication{
		OrgDomain: "example.com", OrgDisplayName: "Example", OpeningNumber: 1,
		OpeningTitle: "Engineer", ApplicationNumber: 1, Status: Applied,
		PendingActions: []PendingActionKind{OfferResponse},
	}
	if !application.Valid() {
		t.Fatal("valid application rejected")
	}
	for name, change := range map[string]func(*MyApplication){
		"status":          func(a *MyApplication) { a.Status = "archived" },
		"pending actions": func(a *MyApplication) { a.PendingActions = nil },
		"unknown action": func(a *MyApplication) {
			a.PendingActions = []PendingActionKind{"sign"}
		},
		"title": func(a *MyApplication) { a.OpeningTitle = " " },
	} {
		changed := application
		change(&changed)
		if changed.Valid() {
			t.Errorf("%s: invalid application accepted", name)
		}
	}
}
