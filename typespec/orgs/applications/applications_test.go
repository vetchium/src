package applications

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/hiring"
)

const stageID = hiring.PipelineStageID("01900000-0000-7000-8000-000000000000")

func TestVocabulariesAreCopiesAndComplete(t *testing.T) {
	t.Parallel()
	want := []ApplicationState{
		"submitted", "in_pipeline", "offered", "offer_accepted",
		"offer_declined", "joined", "did_not_join", "not_progressing",
		"withdrawn",
	}
	if got := ApplicationStates(); !slices.Equal(got, want) {
		t.Fatalf("ApplicationStates() = %v, want %v", got, want)
	}
	ApplicationStates()[0] = "changed"
	StageStatuses()[0] = "changed"
	if ApplicationStates()[0] != Submitted || StageStatuses()[0] != StagePending {
		t.Fatal("caller mutated a vocabulary")
	}
	for _, state := range want {
		if !IsApplicationState(state) {
			t.Errorf("defined state %q rejected", state)
		}
	}
	if IsApplicationState("mystery") || IsApplicationView("mystery") ||
		IsStageStatus("mystery") {
		t.Fatal("an unknown value was accepted")
	}
}

func TestIsCandidacy(t *testing.T) {
	t.Parallel()
	candidacies := map[ApplicationState]bool{
		InPipeline: true, Offered: true, OfferAccepted: true,
	}
	for _, state := range ApplicationStates() {
		if IsCandidacy(state) != candidacies[state] {
			t.Errorf("IsCandidacy(%q) = %v", state, IsCandidacy(state))
		}
	}
}

func TestListApplicationsNormalizesWithoutMutatingTheCaller(t *testing.T) {
	t.Parallel()
	query := ApplicantNameQuery("  ada ")
	request := ListApplicationsRequest{NameQuery: &query}
	request.Normalize()
	if *request.NameQuery != "ada" {
		t.Fatalf("normalized query = %q", *request.NameQuery)
	}
	if query != "  ada " {
		t.Fatal("normalization mutated the caller's query")
	}
}

func TestListApplicationsValidation(t *testing.T) {
	t.Parallel()
	query := func(value string) *ApplicantNameQuery {
		q := ApplicantNameQuery(value)
		return &q
	}
	limit := func(value common.PageSize) *common.PageSize { return &value }
	stage := stageID
	badStage := hiring.PipelineStageID("nope")
	tests := []struct {
		name string
		req  ListApplicationsRequest
		want []string
	}{
		{"applicants", ListApplicationsRequest{OpeningNumber: 1, View: ApplicantsView}, []string{}},
		{"candidates", ListApplicationsRequest{OpeningNumber: 1, View: CandidatesView}, []string{}},
		{"zero opening", ListApplicationsRequest{View: ApplicantsView}, []string{"opening_number"}},
		{"unknown view", ListApplicationsRequest{OpeningNumber: 1, View: "x"}, []string{"view"}},
		{"missing view", ListApplicationsRequest{OpeningNumber: 1}, []string{"view"}},
		{"states in candidates", ListApplicationsRequest{OpeningNumber: 1, View: CandidatesView, States: []ApplicationState{Joined, Withdrawn}}, []string{}},
		{"all eight states", ListApplicationsRequest{OpeningNumber: 1, View: CandidatesView, States: slices.DeleteFunc(ApplicationStates(), func(s ApplicationState) bool { return s == Submitted })}, []string{}},
		{"states in applicants", ListApplicationsRequest{OpeningNumber: 1, View: ApplicantsView, States: []ApplicationState{Joined}}, []string{"states"}},
		{"empty states", ListApplicationsRequest{OpeningNumber: 1, View: CandidatesView, States: []ApplicationState{}}, []string{"states"}},
		{"submitted among states", ListApplicationsRequest{OpeningNumber: 1, View: CandidatesView, States: []ApplicationState{Submitted}}, []string{"states"}},
		{"unknown state", ListApplicationsRequest{OpeningNumber: 1, View: CandidatesView, States: []ApplicationState{"x"}}, []string{"states"}},
		{"duplicate state", ListApplicationsRequest{OpeningNumber: 1, View: CandidatesView, States: []ApplicationState{Joined, Joined}}, []string{"states"}},
		{"stage in candidates", ListApplicationsRequest{OpeningNumber: 1, View: CandidatesView, StageID: &stage}, []string{}},
		{"stage in applicants", ListApplicationsRequest{OpeningNumber: 1, View: ApplicantsView, StageID: &stage}, []string{"stage_id"}},
		{"bad stage id", ListApplicationsRequest{OpeningNumber: 1, View: CandidatesView, StageID: &badStage}, []string{"stage_id"}},
		{"two-character query", ListApplicationsRequest{OpeningNumber: 1, View: ApplicantsView, NameQuery: query("ab")}, []string{}},
		{"one-character query", ListApplicationsRequest{OpeningNumber: 1, View: ApplicantsView, NameQuery: query("a")}, []string{"name_query"}},
		{"padded query", ListApplicationsRequest{OpeningNumber: 1, View: ApplicantsView, NameQuery: query(" ab ")}, []string{"name_query"}},
		{"long query", ListApplicationsRequest{OpeningNumber: 1, View: ApplicantsView, NameQuery: query(strings.Repeat("é", 101))}, []string{"name_query"}},
		{"limit 100", ListApplicationsRequest{OpeningNumber: 1, View: ApplicantsView, Limit: limit(100)}, []string{}},
		{"limit 101", ListApplicationsRequest{OpeningNumber: 1, View: ApplicantsView, Limit: limit(101)}, []string{"limit"}},
		{"limit 0", ListApplicationsRequest{OpeningNumber: 1, View: ApplicantsView, Limit: limit(0)}, []string{"limit"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.req.Validate(); !slices.Equal(got, test.want) {
				t.Fatalf("fields = %v, want %v", got, test.want)
			}
		})
	}
	if (ListApplicationsRequest{}).EffectiveLimit() != 50 {
		t.Fatal("the default limit is 50")
	}
}

func TestApplicationNumbersAndCoverNote(t *testing.T) {
	t.Parallel()
	if !slices.Equal(GetApplicationRequest{OpeningNumber: 1, ApplicationNumber: 1}.Validate(), []string{}) {
		t.Fatal("valid get request rejected")
	}
	if got := (GetApplicationRequest{}).Validate(); !slices.Equal(got, []string{"opening_number", "application_number"}) {
		t.Fatalf("fields = %v", got)
	}
	if got := (GetApplicationCountsRequest{}).Validate(); !slices.Equal(got, []string{"opening_number"}) {
		t.Fatalf("fields = %v", got)
	}
	key := common.PaginationKey("")
	history := ListApplicationHistoryRequest{OpeningNumber: 1, ApplicationNumber: 1, PaginationKey: &key}
	if got := history.Validate(); !slices.Equal(got, []string{"pagination_key"}) {
		t.Fatalf("fields = %v", got)
	}
	if !IsApplicationCoverNote(ApplicationCoverNote(strings.Repeat("é", 5000))) ||
		IsApplicationCoverNote(ApplicationCoverNote(strings.Repeat("é", 5001))) ||
		IsApplicationCoverNote("") {
		t.Fatal("cover note bounds are 1 to 5000 code points")
	}
}

func TestCalendarDates(t *testing.T) {
	t.Parallel()
	for _, valid := range []CalendarDate{"2026-02-28", "2028-02-29", "0999-01-01"} {
		if !IsCalendarDate(valid) {
			t.Errorf("%q rejected", valid)
		}
	}
	for _, invalid := range []CalendarDate{
		"", "2026-02-30", "2026-2-1", "2026-13-01", "tomorrow",
		"2026-02-28T00:00:00Z", " 2026-02-28",
	} {
		if IsCalendarDate(invalid) {
			t.Errorf("%q accepted", invalid)
		}
	}
	instant := time.Date(2026, 3, 1, 23, 30, 0, 0, time.FixedZone("x", -5*3600))
	if got := FormatCalendarDate(instant); got != "2026-03-02" {
		t.Fatalf("FormatCalendarDate = %q, want the UTC date", got)
	}
}

func TestWriteRequestsValidate(t *testing.T) {
	t.Parallel()
	action := ApplicationActionRequest{OpeningNumber: 1, ApplicationNumber: 2, Version: 3}
	if got := action.Validate(); len(got) != 0 {
		t.Fatalf("valid action = %v", got)
	}
	if got := (ApplicationActionRequest{}).Validate(); !slices.Equal(got,
		[]string{"opening_number", "application_number", "version"}) {
		t.Fatalf("empty action = %v", got)
	}
	stage := ApplicationStageRequest{OpeningNumber: 1, ApplicationNumber: 2, Version: 3, StageID: stageID}
	if got := stage.Validate(); len(got) != 0 {
		t.Fatalf("valid stage = %v", got)
	}
	stage.StageID = "nope"
	if got := stage.Validate(); !slices.Equal(got, []string{"stage_id"}) {
		t.Fatalf("bad stage = %v", got)
	}
	joined := ApplicationJoinedOnRequest{OpeningNumber: 1, ApplicationNumber: 2, Version: 3, JoinedOn: "2026-02-30"}
	if got := joined.Validate(); !slices.Equal(got, []string{"joined_on"}) {
		t.Fatalf("bad joined_on = %v", got)
	}
	separated := ApplicationSeparatedOnRequest{OpeningNumber: 1, ApplicationNumber: 2, Version: 3, SeparatedOn: "2026-02-28"}
	if got := separated.Validate(); len(got) != 0 {
		t.Fatalf("valid separated_on = %v", got)
	}
}
