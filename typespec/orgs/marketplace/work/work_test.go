package work

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/openings"
)

const (
	engagementID = marketplace.EngagementID("01900000-0000-7000-8000-000000000001")
	workID       = WorkID("01900000-0000-7000-8000-0000000000aa")
)

func urlPointer(value string) *profile.WebsiteURL {
	link := profile.WebsiteURL(value)
	return &link
}

func orgDomain(value string) *orgs.OrgDomain {
	domain := orgs.OrgDomain(value)
	return &domain
}

func openingNumber(value int32) *openings.OpeningNumber {
	number := openings.OpeningNumber(value)
	return &number
}

func details() applications.InterviewDetails {
	return applications.InterviewDetails{
		StartTime: time.Now().Add(time.Hour), DurationMinutes: 45,
		Mode:              applications.InterviewVideo,
		VideoURL:          urlPointer("https://meet.example.test/x"),
		InterviewerEmails: []common.EmailAddress{"a@acme.test"},
	}
}

func TestWorkStatuses(t *testing.T) {
	t.Parallel()
	want := []WorkStatus{"pending", "scheduled", "awaiting_consent", "in_progress", "completed"}
	if got := WorkStatuses(); !slices.Equal(got, want) {
		t.Fatalf("statuses = %v", got)
	}
	if IsWorkStatus("done") || !IsWorkStatus(Completed) {
		t.Fatal("only the five statuses are valid")
	}
	if !IsWorkID(workID) || IsWorkID("01900000-0000-7000-8000-0000000000AA") || IsWorkID("x") {
		t.Fatal("work ids are lowercase uuids")
	}
}

func TestListWorkQueueRequestValidation(t *testing.T) {
	t.Parallel()
	domain, bad := "acme.test", "x"
	one, zero := int32(1), int32(0)
	name := " Panel "
	status := WorkStatus("scheduled")
	tests := []struct {
		name string
		got  ListWorkQueueRequest
		want []string
	}{
		{"empty", ListWorkQueueRequest{}, []string{}},
		{"opening needs its client", ListWorkQueueRequest{OpeningNumber: openingNumber(1)}, []string{"opening_number"}},
		{"opening with client", ListWorkQueueRequest{OpeningNumber: openingNumber(1), ClientDomain: orgDomain(domain)}, []string{}},
		{"bad client", ListWorkQueueRequest{ClientDomain: orgDomain(bad)}, []string{"client_domain"}},
		{"stage", ListWorkQueueRequest{StageName: &name}, []string{}},
		{"status", ListWorkQueueRequest{Status: &status}, []string{}},
		{"limit", ListWorkQueueRequest{Limit: &one}, []string{}},
		{"limit zero", ListWorkQueueRequest{Limit: &zero}, []string{"limit"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			test.got.Normalize()
			if got := test.got.Validate(); !slices.Equal(got, test.want) {
				t.Fatalf("fields = %v, want %v", got, test.want)
			}
		})
	}
	if (ListWorkQueueRequest{}).EffectiveLimit() != MaxPage {
		t.Fatal("a page is MaxPage by default")
	}
}

func TestWorkWritesValidateTheirOwnFields(t *testing.T) {
	t.Parallel()
	schedule := ScheduleInterviewRequest{EngagementID: engagementID, WorkID: workID, InterviewDetails: details()}
	if got := schedule.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	schedule.InterviewerEmails = nil
	schedule.WorkID = "x"
	if got := schedule.Validate(); !slices.Contains(got, "work_id") ||
		!slices.Contains(got, "interviewer_emails") {
		t.Fatalf("fields = %v", got)
	}
	for _, field := range schedule.Validate() {
		if field == "opening_number" || field == "application_number" || field == "version" {
			t.Fatalf("%s belongs to the client's records, not the provider's request", field)
		}
	}

	change := ChangeInterviewRequest{
		EngagementID: engagementID, WorkID: workID, InterviewNumber: 0,
		InterviewDetails: details(),
	}
	if got := change.Validate(); !slices.Equal(got, []string{"interview_number"}) {
		t.Fatalf("fields = %v", got)
	}
	outcome := RecordInterviewOutcomeRequest{
		EngagementID: engagementID, WorkID: workID, InterviewNumber: 1, Outcome: "late",
	}
	if got := outcome.Validate(); !slices.Equal(got, []string{"outcome"}) {
		t.Fatalf("fields = %v", got)
	}
	feedback := SubmitInterviewFeedbackRequest{
		EngagementID: engagementID, WorkID: workID, InterviewNumber: 1,
		Recommendation: "meh", Notes: "  ",
	}
	feedback.Normalize()
	if got := feedback.Validate(); !slices.Equal(got, []string{"recommendation", "notes"}) {
		t.Fatalf("fields = %v", got)
	}
	score := applications.AssessmentScore(101)
	assessment := RecordAssessmentRequest{
		EngagementID: engagementID, WorkID: workID, Outcome: "pass", Score: &score,
	}
	if got := assessment.Validate(); !slices.Equal(got, []string{"score"}) {
		t.Fatalf("fields = %v", got)
	}
	check := RecordBackgroundCheckResultRequest{
		EngagementID: engagementID, WorkID: workID, CheckType: "identity", Outcome: "clear",
	}
	if got := check.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	check.CheckType = "x"
	if got := check.Validate(); !slices.Equal(got, []string{"check_type"}) {
		t.Fatalf("fields = %v", got)
	}
}

func TestListJobsRequestDefaultsToPublished(t *testing.T) {
	t.Parallel()
	request := ListJobsRequest{}
	if request.EffectiveState() != "published" || request.EffectiveLimit() != MaxPage {
		t.Fatal("jobs default to published, a full page")
	}
	if got := request.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	request.ClientDomain = orgDomain("x")
	state := openings.OpeningState("open")
	request.State = &state
	if got := request.Validate(); !slices.Equal(got, []string{"client_domain", "state"}) {
		t.Fatalf("fields = %v", got)
	}
	if got := (JobReference{}).Validate(); !slices.Equal(got, []string{"engagement_id", "opening_number"}) {
		t.Fatalf("fields = %v", got)
	}
}

func TestWriteResultAndItemsAreChecked(t *testing.T) {
	t.Parallel()
	number := applications.InterviewNumber(1)
	if !(WriteResult{WorkID: workID, Status: Scheduled, InterviewNumber: &number}).Valid() {
		t.Fatal("a result names the work, its status, and an interview")
	}
	if (WriteResult{WorkID: "x", Status: Scheduled}).Valid() ||
		(WriteResult{WorkID: workID, Status: "done"}).Valid() {
		t.Fatal("a result with an unknown id or status is invalid")
	}
	if (WorkItem{}).Valid() || (Job{}).Valid() {
		t.Fatal("empty items are invalid")
	}
	if strings.Contains(string(workID), "application") {
		t.Fatal("a work id carries no application number")
	}
}

func TestListJobsRequestOwnerSearchAndCountryFilters(t *testing.T) {
	t.Parallel()
	owner := common.EmailAddress("  Agent1@Age1.IND1.test ")
	search := JobSearchText("  designer ")
	original := ListJobsRequest{OwnerEmail: &owner, Search: &search}
	normalized := original
	normalized.Normalize()
	if *normalized.OwnerEmail != "agent1@age1.ind1.test" || *normalized.Search != "designer" {
		t.Fatalf("normalized = %q, %q", *normalized.OwnerEmail, *normalized.Search)
	}
	if *original.OwnerEmail != owner || *original.Search != search {
		t.Fatal("Normalize changed the caller's values")
	}
	if got := normalized.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	badOwner := common.EmailAddress("not-an-address")
	empty := JobSearchText("")
	long := JobSearchText(strings.Repeat("x", 101))
	country := common.CountryCode("in")
	request := ListJobsRequest{OwnerEmail: &badOwner, Search: &empty, EmployingCountry: &country}
	if got := request.Validate(); !slices.Equal(got, []string{"owner_email", "search", "employing_country"}) {
		t.Fatalf("fields = %v", got)
	}
	request = ListJobsRequest{Search: &long}
	if got := request.Validate(); !slices.Equal(got, []string{"search"}) {
		t.Fatalf("fields = %v", got)
	}
}

func TestSetJobOwnerRequestValidation(t *testing.T) {
	t.Parallel()
	owner := common.EmailAddress(" Agent2@Age1.SGP.test")
	request := SetJobOwnerRequest{
		EngagementID: engagementID, OpeningNumber: 3, OwnerVersion: 0, OwnerEmail: &owner,
	}
	request.Normalize()
	if *request.OwnerEmail != "agent2@age1.sgp.test" {
		t.Fatalf("owner = %q", *request.OwnerEmail)
	}
	if got := request.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	cleared := SetJobOwnerRequest{EngagementID: engagementID, OpeningNumber: 3, OwnerVersion: 4}
	if got := cleared.Validate(); len(got) != 0 {
		t.Fatalf("an absent owner clears it; fields = %v", got)
	}
	bad := common.EmailAddress("x")
	invalid := SetJobOwnerRequest{EngagementID: "x", OpeningNumber: 0, OwnerVersion: -1, OwnerEmail: &bad}
	if got := invalid.Validate(); !slices.Equal(got,
		[]string{"engagement_id", "opening_number", "owner_version", "owner_email"}) {
		t.Fatalf("fields = %v", got)
	}
}

func TestSuggestionRequestsBoundTheirAnswers(t *testing.T) {
	t.Parallel()
	query := SuggestionQuery("  acme ")
	owners := SuggestJobOwnersRequest{Query: &query}
	owners.Normalize()
	if *owners.Query != "acme" || query != "  acme " {
		t.Fatal("Normalize trims a copy of the query")
	}
	if owners.EffectiveLimit() != MaxSuggestions || len(owners.Validate()) != 0 {
		t.Fatal("suggestions default to the most one answer holds")
	}
	empty := SuggestionQuery("")
	tooMany, none := int32(MaxSuggestions+1), int32(0)
	if got := (SuggestJobOwnersRequest{Query: &empty, Limit: &tooMany}).Validate(); !slices.Equal(got, []string{"query", "limit"}) {
		t.Fatalf("fields = %v", got)
	}
	capability := marketplace.Capability("plumbing")
	if got := (SuggestClientsRequest{Capability: &capability, Limit: &none}).Validate(); !slices.Equal(got, []string{"capability", "limit"}) {
		t.Fatalf("fields = %v", got)
	}
	sourcing := marketplace.Sourcing
	five := int32(5)
	clients := SuggestClientsRequest{Capability: &sourcing, Query: &query, Limit: &five}
	clients.Normalize()
	if got := clients.Validate(); len(got) != 0 || clients.EffectiveLimit() != 5 {
		t.Fatalf("fields = %v", got)
	}
}

func TestPeerJobsCarryNoOwner(t *testing.T) {
	t.Parallel()
	job := Job{
		EngagementID: engagementID,
		Client:       marketplace.EngagementCounterparty{Domain: "org1.ind1.test", DisplayName: "IND1 Hiring Co 1"},
		Opening:      WorkOpening{Number: 3, Title: "Designer"},
		State:        openings.Published, AssignedAt: time.Now(),
	}
	if !job.Valid() {
		t.Fatal("a peer's Job is valid")
	}
	owner := common.EmailAddress("agent1@age1.ind1.test")
	job.Owner = &owner
	if job.Valid() {
		t.Fatal("a client's tenant never names the agency's owner")
	}
}
