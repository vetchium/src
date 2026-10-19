package applications

import (
	"slices"
	"strings"
	"testing"
	"time"

	orgapplications "github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"
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

func TestMyApplicationDetailOfferValidity(t *testing.T) {
	t.Parallel()
	date := orgapplications.CalendarDate("2026-12-01")
	detail := MyApplicationDetail{
		MyApplication: MyApplication{
			OrgDomain: "example.com", OrgDisplayName: "Example",
			OpeningNumber: 1, OpeningTitle: "Engineer", ApplicationNumber: 1,
			Status: Offer, PendingActions: []PendingActionKind{OfferResponse},
		},
		Offer: &MyApplicationOffer{
			OfferNumber: 1, Status: orgapplications.OfferStatusExtended,
			LetterURL:      "https://media.sgp.vetchium.com/org-offer-letters/x",
			LetterByteSize: 10, ProposedJoiningDate: &date,
			RespondBy: time.Now().Add(time.Hour), ExtendedAt: time.Now(),
		},
		Interviews: []MyApplicationInterview{},
	}
	if !detail.Valid() {
		t.Fatal("valid detail rejected")
	}
	if !(MyApplicationDetail{
		MyApplication: detail.MyApplication, Interviews: []MyApplicationInterview{},
	}).Valid() {
		t.Fatal("a detail without an offer was rejected")
	}
	bad := orgapplications.CalendarDate("2026-02-30")
	for name, change := range map[string]func(*MyApplicationOffer){
		"withdrawn":     func(o *MyApplicationOffer) { o.Status = "withdrawn" },
		"unknown":       func(o *MyApplicationOffer) { o.Status = "pending" },
		"number":        func(o *MyApplicationOffer) { o.OfferNumber = 0 },
		"link":          func(o *MyApplicationOffer) { o.LetterURL = "" },
		"size":          func(o *MyApplicationOffer) { o.LetterByteSize = 0 },
		"date":          func(o *MyApplicationOffer) { o.ProposedJoiningDate = &bad },
		"deadline":      func(o *MyApplicationOffer) { o.RespondBy = time.Time{} },
		"extended time": func(o *MyApplicationOffer) { o.ExtendedAt = time.Time{} },
	} {
		offer := *detail.Offer
		change(&offer)
		changed := detail
		changed.Offer = &offer
		if changed.Valid() {
			t.Errorf("%s: invalid offer accepted", name)
		}
	}
}

func TestRespondToOfferRequestValidation(t *testing.T) {
	t.Parallel()
	request := RespondToOfferRequest{
		ApplicationReference: ApplicationReference{
			Domain: " Example.COM ", OpeningNumber: 1, ApplicationNumber: 2,
		},
		OfferNumber: 1,
	}
	request.Normalize()
	if request.Domain != "example.com" || len(request.Validate()) != 0 {
		t.Fatalf("valid request: %+v %v", request, request.Validate())
	}
	request.OfferNumber = 0
	request.ApplicationNumber = 0
	if got := request.Validate(); !slices.Equal(got,
		[]string{"application_number", "offer_number"}) {
		t.Fatalf("fields = %v", got)
	}
}

func TestMyApplicationInterviewValidity(t *testing.T) {
	t.Parallel()
	link := "https://meet.example.com/room"
	place := orgapplications.InterviewLocation("Room 4")
	note := orgapplications.InterviewRescheduleNote("later")
	good := MyApplicationInterview{
		InterviewNumber: 1, State: MyInterviewScheduled,
		StartsAt: time.Now(), DurationMinutes: 30,
		Mode: orgapplications.InterviewVideo, VideoURL: &link,
		Response: orgapplications.ResponsePending,
	}
	if !good.Valid() {
		t.Fatal("a valid video interview was rejected")
	}
	inPerson := good
	inPerson.Mode, inPerson.VideoURL, inPerson.Location =
		orgapplications.InterviewInPerson, nil, &place
	if !inPerson.Valid() {
		t.Fatal("a valid in-person interview was rejected")
	}
	for name, mutate := range map[string]func(*MyApplicationInterview){
		"unknown state":    func(i *MyApplicationInterview) { i.State = "completed" },
		"video no link":    func(i *MyApplicationInterview) { i.VideoURL = nil },
		"note unrequested": func(i *MyApplicationInterview) { i.RescheduleNote = &note },
		"note missing": func(i *MyApplicationInterview) {
			i.Response = orgapplications.ResponseRescheduleRequest
		},
		"short": func(i *MyApplicationInterview) { i.DurationMinutes = 5 },
	} {
		bad := good
		mutate(&bad)
		if bad.Valid() {
			t.Errorf("%s accepted", name)
		}
	}
	detail := MyApplicationDetail{
		MyApplication: MyApplication{
			OrgDomain: "example.com", OrgDisplayName: "Example",
			OpeningNumber: 1, OpeningTitle: "Engineer", ApplicationNumber: 1,
			Status: Applied, PendingActions: []PendingActionKind{},
		},
		Interviews: []MyApplicationInterview{good},
	}
	if !detail.Valid() {
		t.Fatal("a valid detail was rejected")
	}
	detail.Interviews = nil
	if detail.Valid() {
		t.Fatal("a detail without an interviews array was accepted")
	}
}

func TestInterviewResponseRequests(t *testing.T) {
	t.Parallel()
	reference := InterviewReference{
		ApplicationReference: ApplicationReference{
			Domain: " Example.COM", OpeningNumber: 1, ApplicationNumber: 2,
		},
		InterviewNumber: 3,
	}
	reschedule := RequestInterviewRescheduleRequest{
		InterviewReference: reference, Note: "  later ",
	}
	reschedule.Normalize()
	if reschedule.Domain != "example.com" || reschedule.Note != "later" ||
		reference.Domain != " Example.COM" {
		t.Fatalf("normalized = %+v", reschedule)
	}
	if got := reschedule.Validate(); len(got) != 0 {
		t.Fatalf("valid request rejected: %v", got)
	}
	reschedule.Note, reschedule.InterviewNumber = "", 0
	if got := reschedule.Validate(); !slices.Equal(got, []string{
		"interview_number", "note",
	}) {
		t.Fatalf("fields = %v", got)
	}
}

func TestMyBackgroundCheckConsentValidity(t *testing.T) {
	t.Parallel()
	detail := MyApplicationDetail{
		MyApplication: MyApplication{
			OrgDomain: "example.com", OrgDisplayName: "Example",
			OpeningNumber: 1, OpeningTitle: "Engineer", ApplicationNumber: 1,
			Status:         InReview,
			PendingActions: []PendingActionKind{BackgroundCheckConsent},
		},
		BackgroundCheckConsent: &MyBackgroundCheckConsent{
			CheckNumber: 1, CheckTypes: []hiring.CheckType{"identity", "drug"},
			Performer: orgapplications.PerformerOrg, RequestedAt: time.Now(),
		},
		Interviews: []MyApplicationInterview{},
	}
	if !detail.Valid() {
		t.Fatal("valid detail rejected")
	}
	for name, change := range map[string]func(*MyBackgroundCheckConsent){
		"number":    func(c *MyBackgroundCheckConsent) { c.CheckNumber = 0 },
		"no types":  func(c *MyBackgroundCheckConsent) { c.CheckTypes = nil },
		"unknown":   func(c *MyBackgroundCheckConsent) { c.CheckTypes = []hiring.CheckType{"astrology"} },
		"duplicate": func(c *MyBackgroundCheckConsent) { c.CheckTypes = []hiring.CheckType{"drug", "drug"} },
		"performer": func(c *MyBackgroundCheckConsent) { c.Performer = "stranger" },
		"requested": func(c *MyBackgroundCheckConsent) { c.RequestedAt = time.Time{} },
	} {
		consent := *detail.BackgroundCheckConsent
		change(&consent)
		changed := detail
		changed.BackgroundCheckConsent = &consent
		if changed.Valid() {
			t.Errorf("%s: invalid consent accepted", name)
		}
	}
}

func TestBackgroundCheckConsentRequestValidation(t *testing.T) {
	t.Parallel()
	request := BackgroundCheckConsentRequest{
		ApplicationReference: ApplicationReference{
			Domain: " Example.COM ", OpeningNumber: 1, ApplicationNumber: 2,
		},
		CheckNumber: 1,
	}
	request.Normalize()
	if request.Domain != "example.com" || len(request.Validate()) != 0 {
		t.Fatalf("valid request: %q %v", request.Domain, request.Validate())
	}
	request.CheckNumber, request.ApplicationNumber = 0, 0
	want := []string{"application_number", "check_number"}
	if got := request.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}
