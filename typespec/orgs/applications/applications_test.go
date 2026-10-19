package applications

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub/profile"
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

func TestOfferVocabularyAndLetterRules(t *testing.T) {
	t.Parallel()
	want := []OfferStatus{
		"extended", "accepted", "declined", "expired", "withdrawn",
	}
	if got := OfferStatuses(); !slices.Equal(got, want) {
		t.Fatalf("OfferStatuses() = %v", got)
	}
	OfferStatuses()[0] = "changed"
	if OfferStatuses()[0] != OfferStatusExtended || IsOfferStatus("pending") {
		t.Fatal("offer vocabulary is not closed and copied")
	}
	if !IsPDF([]byte("%PDF-1.7\n")) || IsPDF([]byte("%PDF")) ||
		IsPDF([]byte("GIF89a")) || IsPDF(nil) {
		t.Fatal("PDF signature check is wrong")
	}
	if MaxOfferLetterBytes != 5242880 {
		t.Fatalf("letter limit = %d", MaxOfferLetterBytes)
	}
}

func TestExtendApplicationOfferValidation(t *testing.T) {
	t.Parallel()
	date := CalendarDate("2026-12-01")
	valid := ExtendApplicationOfferRequest{
		OpeningNumber: 1, ApplicationNumber: 2, Version: 3,
		LetterID:            "01900000-0000-4000-8000-000000000000",
		ProposedJoiningDate: &date, RespondWithinDays: 60,
	}
	if got := valid.Validate(); len(got) != 0 {
		t.Fatalf("valid request rejected: %v", got)
	}
	withoutDate := valid
	withoutDate.ProposedJoiningDate = nil
	withoutDate.RespondWithinDays = 1
	if got := withoutDate.Validate(); len(got) != 0 {
		t.Fatalf("request without a date rejected: %v", got)
	}
	bad := CalendarDate("2026-12-1")
	invalid := ExtendApplicationOfferRequest{
		LetterID: "01900000-0000-4000-8000-00000000000A", ProposedJoiningDate: &bad,
		RespondWithinDays: 61,
	}
	want := []string{
		"opening_number", "application_number", "version", "letter_id",
		"proposed_joining_date", "respond_within_days",
	}
	if got := invalid.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	invalid.RespondWithinDays = 0
	if got := invalid.Validate(); !slices.Contains(got, "respond_within_days") {
		t.Fatalf("zero days accepted: %v", got)
	}
}

func interviewDetails() InterviewDetails {
	link := profile.WebsiteURL("https://meet.example.com/room")
	return InterviewDetails{
		StartTime:         time.Date(2026, 12, 1, 9, 0, 0, 0, time.UTC),
		DurationMinutes:   60,
		Mode:              InterviewVideo,
		VideoURL:          &link,
		InterviewerEmails: []common.EmailAddress{"a@example.com", "b@example.com"},
	}
}

func TestInterviewVocabulariesAreCopiesAndComplete(t *testing.T) {
	t.Parallel()
	if !slices.Equal(InterviewModes(), []InterviewMode{"video", "in_person"}) ||
		!slices.Equal(InterviewStates(), []InterviewState{
			"scheduled", "completed", "no_show", "cancelled",
		}) ||
		!slices.Equal(InterviewResponses(), []InterviewResponse{
			"pending", "accepted", "reschedule_requested",
		}) ||
		!slices.Equal(InterviewRecommendations(), []InterviewRecommendation{
			"strong_yes", "yes", "no", "strong_no",
		}) ||
		!slices.Equal(PendingApplicantActions(), []PendingApplicantAction{
			"interview_response", "background_check_consent", "offer_response",
		}) {
		t.Fatal("an interview vocabulary changed")
	}
	InterviewModes()[0] = "changed"
	InterviewStates()[0] = "changed"
	if !IsInterviewMode(InterviewVideo) || !IsInterviewState(InterviewScheduled) {
		t.Fatal("caller mutated a vocabulary")
	}
	if IsInterviewMode("x") || IsInterviewState("x") || IsInterviewResponse("x") ||
		IsInterviewRecommendation("x") || IsPendingApplicantAction("x") ||
		IsInterviewOutcome("cancelled") {
		t.Fatal("an unknown value was accepted")
	}
}

func TestInterviewBounds(t *testing.T) {
	t.Parallel()
	for minutes, want := range map[InterviewDurationMinutes]bool{
		14: false, 15: true, 480: true, 481: false,
	} {
		if IsInterviewDurationMinutes(minutes) != want {
			t.Errorf("duration %d = %v", minutes, !want)
		}
	}
	long := strings.Repeat("é", 500)
	if !IsInterviewLocation(InterviewLocation(long)) ||
		IsInterviewLocation(InterviewLocation(long+"x")) ||
		IsInterviewLocation(" room") || IsInterviewLocation("") {
		t.Fatal("location bounds")
	}
	if !IsInterviewRescheduleNote(InterviewRescheduleNote(long)) ||
		IsInterviewRescheduleNote(InterviewRescheduleNote(long+"x")) {
		t.Fatal("reschedule note bounds")
	}
	notes := strings.Repeat("é", 10000)
	if !IsInterviewFeedbackNotes(InterviewFeedbackNotes(notes)) ||
		IsInterviewFeedbackNotes(InterviewFeedbackNotes(notes+"x")) ||
		IsInterviewFeedbackNotes(" ") {
		t.Fatal("feedback notes bounds")
	}
}

func TestScheduleInterviewValidation(t *testing.T) {
	t.Parallel()
	valid := ScheduleInterviewRequest{
		OpeningNumber: 1, ApplicationNumber: 2, Version: 3,
		InterviewDetails: interviewDetails(),
	}
	if got := valid.Validate(); len(got) != 0 {
		t.Fatalf("valid request rejected: %v", got)
	}
	place := InterviewLocation("Room 4")
	inPerson := valid
	inPerson.Mode, inPerson.VideoURL, inPerson.Location =
		InterviewInPerson, nil, &place
	if got := inPerson.Validate(); len(got) != 0 {
		t.Fatalf("in-person request rejected: %v", got)
	}
	for name, mutate := range map[string]func(*ScheduleInterviewRequest){
		"video without a link": func(r *ScheduleInterviewRequest) { r.VideoURL = nil },
		"video with a place":   func(r *ScheduleInterviewRequest) { r.Location = &place },
		"in person without a place": func(r *ScheduleInterviewRequest) {
			r.Mode, r.VideoURL = InterviewInPerson, nil
		},
		"in person with a link": func(r *ScheduleInterviewRequest) {
			r.Mode, r.Location = InterviewInPerson, &place
		},
		"http link": func(r *ScheduleInterviewRequest) {
			link := profile.WebsiteURL("http://meet.example.com/room")
			r.VideoURL = &link
		},
	} {
		request := valid
		mutate(&request)
		if got := request.Validate(); len(got) == 0 {
			t.Errorf("%s accepted", name)
		}
	}
	invalid := ScheduleInterviewRequest{
		InterviewDetails: InterviewDetails{
			DurationMinutes: 5, Mode: "phone",
			InterviewerEmails: []common.EmailAddress{"a@example.com", "a@example.com"},
		},
	}
	want := []string{
		"opening_number", "application_number", "version", "start_time",
		"duration_minutes", "mode", "interviewer_emails",
	}
	if got := invalid.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	emails := make([]common.EmailAddress, 11)
	for index := range emails {
		emails[index] = common.EmailAddress("u" + string(rune('a'+index)) + "@example.com")
	}
	tooMany := valid
	tooMany.InterviewerEmails = emails
	if got := tooMany.Validate(); !slices.Contains(got, "interviewer_emails") {
		t.Fatalf("eleven interviewers accepted: %v", got)
	}
	tooMany.InterviewerEmails = emails[:10]
	if got := tooMany.Validate(); len(got) != 0 {
		t.Fatalf("ten interviewers rejected: %v", got)
	}
	tooMany.InterviewerEmails = nil
	if got := tooMany.Validate(); !slices.Contains(got, "interviewer_emails") {
		t.Fatalf("no interviewer accepted: %v", got)
	}
}

func TestInterviewDetailsNormalizeWithoutMutatingTheCaller(t *testing.T) {
	t.Parallel()
	link := profile.WebsiteURL(" HTTPS://Meet.Example.com/Room/ ")
	place := InterviewLocation("  Room 4 ")
	emails := []common.EmailAddress{" A@Example.com "}
	request := ChangeInterviewRequest{
		InterviewNumber: 1,
		InterviewDetails: InterviewDetails{
			StartTime: time.Date(2026, 12, 1, 9, 0, 0, 0, time.FixedZone("x", 3600)),
			VideoURL:  &link, Location: &place, InterviewerEmails: emails,
		},
	}
	request.Normalize()
	if *request.VideoURL != "https://meet.example.com/Room" ||
		*request.Location != "Room 4" ||
		request.InterviewerEmails[0] != "a@example.com" ||
		request.StartTime.Location() != time.UTC {
		t.Fatalf("normalized = %+v", request)
	}
	if link != " HTTPS://Meet.Example.com/Room/ " || place != "  Room 4 " ||
		emails[0] != " A@Example.com " {
		t.Fatal("the caller's values were mutated")
	}
}

func TestInterviewActionRequests(t *testing.T) {
	t.Parallel()
	cancel := CancelInterviewRequest{
		OpeningNumber: 1, ApplicationNumber: 2, Version: 3, InterviewNumber: 4,
	}
	if got := cancel.Validate(); len(got) != 0 {
		t.Fatalf("valid cancel rejected: %v", got)
	}
	if got := (CancelInterviewRequest{}).Validate(); !slices.Equal(got, []string{
		"opening_number", "application_number", "version", "interview_number",
	}) {
		t.Fatalf("cancel fields = %v", got)
	}
	outcome := RecordInterviewOutcomeRequest{
		OpeningNumber: 1, ApplicationNumber: 2, Version: 3, InterviewNumber: 4,
		Outcome: OutcomeNoShow,
	}
	if got := outcome.Validate(); len(got) != 0 {
		t.Fatalf("valid outcome rejected: %v", got)
	}
	outcome.Outcome = "cancelled"
	if got := outcome.Validate(); !slices.Equal(got, []string{"outcome"}) {
		t.Fatalf("outcome fields = %v", got)
	}
	feedback := SubmitInterviewFeedbackRequest{
		OpeningNumber: 1, ApplicationNumber: 2, Version: 3, InterviewNumber: 4,
		Recommendation: Yes, Notes: "  solid ",
	}
	feedback.Normalize()
	if feedback.Notes != "solid" {
		t.Fatalf("notes = %q", feedback.Notes)
	}
	if got := feedback.Validate(); len(got) != 0 {
		t.Fatalf("valid feedback rejected: %v", got)
	}
	feedback.Recommendation, feedback.Notes = "maybe", ""
	if got := feedback.Validate(); !slices.Equal(got, []string{
		"recommendation", "notes",
	}) {
		t.Fatalf("feedback fields = %v", got)
	}
}

func TestListApplicationsPendingApplicantAction(t *testing.T) {
	t.Parallel()
	action := InterviewResponseAction
	request := ListApplicationsRequest{
		OpeningNumber: 1, View: CandidatesView, PendingApplicantAction: &action,
	}
	if got := request.Validate(); len(got) != 0 {
		t.Fatalf("filter rejected: %v", got)
	}
	request.View = ApplicantsView
	if got := request.Validate(); !slices.Equal(got, []string{"pending_applicant_action"}) {
		t.Fatalf("applicants view fields = %v", got)
	}
	unknown := PendingApplicantAction("sign")
	request.View, request.PendingApplicantAction = CandidatesView, &unknown
	if got := request.Validate(); !slices.Equal(got, []string{"pending_applicant_action"}) {
		t.Fatalf("unknown fields = %v", got)
	}
}

func TestListMyInterviewsValidation(t *testing.T) {
	t.Parallel()
	zero := common.PageSize(0)
	request := ListMyInterviewsRequest{Limit: &zero}
	if got := request.Validate(); !slices.Equal(got, []string{"limit"}) {
		t.Fatalf("fields = %v", got)
	}
	if (ListMyInterviewsRequest{}).EffectiveLimit() != 50 {
		t.Fatal("default limit")
	}
}

func TestResultVocabulariesAreCopiesAndComplete(t *testing.T) {
	t.Parallel()
	if !slices.Equal(AssessmentOutcomes(), []AssessmentOutcome{
		"pass", "fail", "inconclusive",
	}) || !slices.Equal(CheckOutcomes(), []CheckOutcome{
		"clear", "discrepancy", "unable_to_verify",
	}) || !slices.Equal(ConsentStates(), []ConsentState{
		"requested", "given", "declined", "ended",
	}) || !slices.Equal(WorkPerformers(), []WorkPerformer{"org"}) {
		t.Fatal("a result vocabulary changed")
	}
	AssessmentOutcomes()[0] = "changed"
	CheckOutcomes()[0] = "changed"
	if !IsAssessmentOutcome(AssessmentPass) || !IsCheckOutcome(CheckClear) {
		t.Fatal("caller mutated a vocabulary")
	}
	if IsAssessmentOutcome("x") || IsCheckOutcome("x") ||
		IsConsentState("x") || IsWorkPerformer("x") {
		t.Fatal("an unknown value was accepted")
	}
}

func TestResultBounds(t *testing.T) {
	t.Parallel()
	for score, want := range map[AssessmentScore]bool{
		-1: false, 0: true, 100: true, 101: false,
	} {
		if IsAssessmentScore(score) != want {
			t.Errorf("score %d = %v", score, !want)
		}
	}
	long := strings.Repeat("é", 2000)
	if !IsResultNotes(ResultNotes(long)) || IsResultNotes(ResultNotes(long+"x")) ||
		IsResultNotes(" note") || IsResultNotes("") {
		t.Fatal("notes bounds")
	}
	if !IsBackgroundCheckNumber(1) || IsBackgroundCheckNumber(0) {
		t.Fatal("check number bound")
	}
}

func resultReference() RecordAssessmentResultRequest {
	return RecordAssessmentResultRequest{
		OpeningNumber: 1, ApplicationNumber: 2, Version: 3, Outcome: AssessmentPass,
	}
}

func TestRecordAssessmentResultNormalizesWithoutMutatingTheCaller(t *testing.T) {
	t.Parallel()
	notes := ResultNotes("  solid ")
	link := profile.WebsiteURL("HTTPS://Reports.Example.com/a/")
	request := resultReference()
	request.Notes, request.ReportURL = &notes, &link
	request.Normalize()
	if *request.Notes != "solid" || *request.ReportURL != "https://reports.example.com/a" {
		t.Fatalf("normalized = %q %q", *request.Notes, *request.ReportURL)
	}
	if notes != "  solid " || link != "HTTPS://Reports.Example.com/a/" {
		t.Fatal("the caller's values changed")
	}
	blank := ResultNotes(" \n")
	request.Notes = &blank
	request.Normalize()
	if request.Notes != nil {
		t.Fatalf("blank notes kept: %q", *request.Notes)
	}
}

func TestRecordAssessmentResultValidates(t *testing.T) {
	t.Parallel()
	if got := resultReference().Validate(); len(got) != 0 {
		t.Fatalf("valid request rejected: %v", got)
	}
	score, link, notes := AssessmentScore(101), profile.WebsiteURL("http://x.example.com"), ResultNotes(strings.Repeat("x", 2001))
	invalid := RecordAssessmentResultRequest{
		Outcome: "maybe", Score: &score, Notes: &notes, ReportURL: &link,
	}
	want := []string{
		"opening_number", "application_number", "version", "outcome", "score",
		"notes", "report_url",
	}
	if got := invalid.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	for _, edge := range []AssessmentScore{0, 100} {
		request := resultReference()
		request.Score = &edge
		if got := request.Validate(); len(got) != 0 {
			t.Errorf("score %d rejected: %v", edge, got)
		}
	}
}

func TestRequestBackgroundCheckConsentValidatesTypes(t *testing.T) {
	t.Parallel()
	request := RequestBackgroundCheckConsentRequest{
		OpeningNumber: 1, ApplicationNumber: 2, Version: 3,
		CheckTypes: []hiring.CheckType{"identity", "criminal"},
	}
	if got := request.Validate(); len(got) != 0 {
		t.Fatalf("valid request rejected: %v", got)
	}
	for name, types := range map[string][]hiring.CheckType{
		"none": {}, "nil": nil, "unknown": {"astrology"},
		"duplicate": {"identity", "identity"},
	} {
		request.CheckTypes = types
		if got := request.Validate(); !slices.Equal(got, []string{"check_types"}) {
			t.Errorf("%s: fields = %v", name, got)
		}
	}
}

func TestRecordBackgroundCheckResultNormalizesAndValidates(t *testing.T) {
	t.Parallel()
	notes := ResultNotes("  fine ")
	request := RecordBackgroundCheckResultRequest{
		OpeningNumber: 1, ApplicationNumber: 2, Version: 3,
		CheckType: "identity", Outcome: CheckClear, Notes: &notes,
	}
	request.Normalize()
	if *request.Notes != "fine" || notes != "  fine " {
		t.Fatalf("notes = %q, caller %q", *request.Notes, notes)
	}
	if got := request.Validate(); len(got) != 0 {
		t.Fatalf("valid request rejected: %v", got)
	}
	link := profile.WebsiteURL("ftp://x.example.com")
	request.CheckType, request.Outcome, request.ReportURL = "astrology", "ok", &link
	want := []string{"check_type", "outcome", "report_url"}
	if got := request.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}
