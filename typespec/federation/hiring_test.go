package federation

import (
	"slices"
	"strings"
	"testing"
	"time"

	hubapplications "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs/applications"
)

func validPayload() HubApplyPayload {
	return HubApplyPayload{
		OpeningNumber: 1,
		ApplicantDID:  "01900000-0000-7000-8000-000000000001",
		Snapshot: profile.ApplicantSnapshot{
			DisplayName: "Ada", Handle: "abcd1234-0123456789a",
			ResidentCountry: "GB",
		},
	}
}

func TestHubApplyKindIsAValidCommandKind(t *testing.T) {
	t.Parallel()
	if !IsCommandKind(HubApplyKind) || HubApplyKind != "hub-apply" {
		t.Fatalf("kind = %q", HubApplyKind)
	}
}

func TestHubApplyPayloadNormalizesWithoutMutatingTheCaller(t *testing.T) {
	t.Parallel()
	note := applications.ApplicationCoverNote("  hello ")
	payload := validPayload()
	payload.CoverNote = &note
	payload.Referral = &ApplicationReferral{
		AgencyDomain: " Agency.COM ",
		Route:        "suggested",
	}
	normalized := payload
	normalized.Normalize()
	if *normalized.CoverNote != "hello" || normalized.Snapshot.Websites == nil ||
		normalized.Referral.AgencyDomain != "agency.com" {
		t.Fatalf("unexpected normalization: %+v", normalized)
	}
	if note != "  hello " || payload.Snapshot.Websites != nil || payload.Referral.AgencyDomain != " Agency.COM " {
		t.Fatal("normalization mutated the caller's values")
	}
	blank := applications.ApplicationCoverNote("   ")
	payload.CoverNote = &blank
	payload.Normalize()
	if payload.CoverNote != nil {
		t.Fatal("a blank cover note is dropped")
	}
}

func TestHubApplyPayloadValidation(t *testing.T) {
	t.Parallel()
	good := validPayload()
	good.Normalize()
	if got := good.Validate(); len(got) != 0 {
		t.Fatalf("valid payload rejected: %v", got)
	}
	long := applications.ApplicationCoverNote(strings.Repeat("a", 5001))
	exact := applications.ApplicationCoverNote(strings.Repeat("é", 5000))
	bad := validPayload()
	bad.OpeningNumber, bad.ApplicantDID, bad.CoverNote = 0, "x", &long
	bad.Referral = &ApplicationReferral{AgencyDomain: "bad domain", Route: "unknown"}
	bad.Snapshot.DisplayName = ""
	want := []string{"opening_number", "applicant_did", "referral.agency_domain", "referral.route", "cover_note", "snapshot.display_name"}
	if got := bad.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	good.CoverNote = &exact
	if got := good.Validate(); len(got) != 0 {
		t.Fatalf("5,000 code points rejected: %v", got)
	}
}

func TestHubWithdrawAndProjectionKinds(t *testing.T) {
	t.Parallel()
	if !IsCommandKind(HubWithdrawKind) || HubWithdrawKind != "hub-withdraw" {
		t.Fatalf("kind = %q", HubWithdrawKind)
	}
	if !IsEventKind(HubApplicationChangedKind) ||
		!IsAggregateType(OrgApplicationAggregate) {
		t.Fatalf("event = %q %q", HubApplicationChangedKind,
			OrgApplicationAggregate)
	}
}

func TestHubApplicationNoticeAndRemovedPayload(t *testing.T) {
	t.Parallel()
	changed := HubApplicationChangedPayload{
		OrgDID: "01900000-0000-7000-8000-000000000002", OrgDomain: "example.com",
		OrgDisplayName: "Example", OpeningNumber: 1, OpeningTitle: "Engineer",
		ApplicationNumber: 1, Status: hubapplications.Applied,
		PendingActions: []hubapplications.PendingActionKind{},
		AppliedAt:      time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
		LastActivityAt: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
	}
	for _, notice := range append(ApplicationNotices(), "") {
		changed.Notice = notice
		if got := changed.Validate(); len(got) != 0 {
			t.Fatalf("notice %q rejected: %v", notice, got)
		}
	}
	changed.Notice = "offer_text"
	if got := changed.Validate(); !slices.Equal(got, []string{"notice"}) {
		t.Fatalf("unknown notice fields = %v", got)
	}
	if !IsEventKind(HubApplicationRemovedKind) {
		t.Fatalf("kind = %q", HubApplicationRemovedKind)
	}
	removed := HubApplicationRemovedPayload{
		OrgDID:        "01900000-0000-7000-8000-000000000002",
		OpeningNumber: 1, ApplicationNumber: 1,
	}
	if got := removed.Validate(); len(got) != 0 {
		t.Fatalf("valid removal rejected: %v", got)
	}
	want := []string{"org_did", "opening_number", "application_number"}
	if got := (HubApplicationRemovedPayload{}).Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}

func TestHubWithdrawPayloadValidation(t *testing.T) {
	t.Parallel()
	good := HubWithdrawPayload{
		OpeningNumber: 1, ApplicationNumber: 2,
		ApplicantDID: "01900000-0000-7000-8000-000000000001",
	}
	if got := good.Validate(); len(got) != 0 {
		t.Fatalf("valid payload rejected: %v", got)
	}
	bad := HubWithdrawPayload{ApplicantDID: "01900000-0000-4000-8000-000000000001"}
	want := []string{"opening_number", "application_number", "applicant_did"}
	if got := bad.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}

func TestHubApplicationChangedPayloadValidation(t *testing.T) {
	t.Parallel()
	applied := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	good := HubApplicationChangedPayload{
		OrgDID:    "01900000-0000-7000-8000-000000000002",
		OrgDomain: "example.com", OrgDisplayName: "Example",
		OpeningNumber: 1, OpeningTitle: "Engineer", ApplicationNumber: 1,
		Status:         hubapplications.Applied,
		PendingActions: []hubapplications.PendingActionKind{},
		AppliedAt:      applied, LastActivityAt: applied,
	}
	if got := good.Validate(); len(got) != 0 {
		t.Fatalf("valid payload rejected: %v", got)
	}
	bad := HubApplicationChangedPayload{
		OrgDID: "x", OrgDomain: "Example.COM", OpeningTitle: " ",
		Status:         "archived",
		PendingActions: []hubapplications.PendingActionKind{"sign"},
		AppliedAt:      applied, LastActivityAt: applied.Add(-time.Second),
	}
	want := []string{
		"org_did", "org_domain", "org_display_name", "opening_number",
		"opening_title", "application_number", "status", "pending_actions",
		"last_activity_at",
	}
	if got := bad.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	bad.PendingActions, bad.AppliedAt = nil, time.Time{}
	if got := bad.Validate(); !slices.Contains(got, "pending_actions") ||
		!slices.Contains(got, "applied_at") {
		t.Fatalf("fields = %v", got)
	}
}

func TestHubOfferResponseKindsAndPayload(t *testing.T) {
	t.Parallel()
	for _, kind := range []CommandKind{HubAcceptOfferKind, HubDeclineOfferKind} {
		if !IsCommandKind(kind) {
			t.Fatalf("kind %q is not a command kind", kind)
		}
	}
	if HubAcceptOfferKind != "hub-accept-offer" ||
		HubDeclineOfferKind != "hub-decline-offer" {
		t.Fatal("offer answer kinds changed")
	}
	payload := HubOfferResponsePayload{
		OpeningNumber: 1, ApplicationNumber: 2, OfferNumber: 3,
		ApplicantDID: "01900000-0000-7000-8000-000000000001",
	}
	payload.Normalize()
	if got := payload.Validate(); len(got) != 0 {
		t.Fatalf("valid payload rejected: %v", got)
	}
	bad := HubOfferResponsePayload{ApplicantDID: "x"}
	want := []string{
		"opening_number", "application_number", "offer_number", "applicant_did",
	}
	if got := bad.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}

func TestHubInterviewResponseKindsAndPayloads(t *testing.T) {
	t.Parallel()
	if HubAcceptInterviewKind != "hub-accept-interview" ||
		HubRescheduleInterviewKind != "hub-request-interview-reschedule" ||
		!IsCommandKind(HubAcceptInterviewKind) ||
		!IsCommandKind(HubRescheduleInterviewKind) {
		t.Fatal("interview response kinds changed")
	}
	accept := HubAcceptInterviewPayload{
		OpeningNumber: 1, ApplicationNumber: 2, InterviewNumber: 3,
		ApplicantDID: "01900000-0000-7000-8000-000000000001",
	}
	if got := accept.Validate(); len(got) != 0 {
		t.Fatalf("valid payload rejected: %v", got)
	}
	want := []string{
		"opening_number", "application_number", "interview_number",
		"applicant_did",
	}
	if got := (HubAcceptInterviewPayload{ApplicantDID: "x"}).Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	reschedule := HubRescheduleInterviewPayload{
		OpeningNumber: 1, ApplicationNumber: 2, InterviewNumber: 3,
		ApplicantDID: accept.ApplicantDID, Note: "  later ",
	}
	reschedule.Normalize()
	if reschedule.Note != "later" {
		t.Fatalf("note = %q", reschedule.Note)
	}
	if got := reschedule.Validate(); len(got) != 0 {
		t.Fatalf("valid payload rejected: %v", got)
	}
	reschedule.Note = ""
	if got := reschedule.Validate(); !slices.Equal(got, []string{"note"}) {
		t.Fatalf("fields = %v", got)
	}
}

func TestHubConsentKindsAndPayload(t *testing.T) {
	t.Parallel()
	if HubGiveConsentKind != "hub-give-background-check-consent" ||
		HubDeclineConsentKind != "hub-decline-background-check-consent" ||
		!IsCommandKind(HubGiveConsentKind) || !IsCommandKind(HubDeclineConsentKind) {
		t.Fatal("consent kinds changed")
	}
	payload := HubBackgroundCheckConsentPayload{
		OpeningNumber: 1, ApplicationNumber: 2, CheckNumber: 3,
		ApplicantDID: "01900000-0000-7000-8000-000000000001",
	}
	if got := payload.Validate(); len(got) != 0 {
		t.Fatalf("valid payload rejected: %v", got)
	}
	want := []string{
		"opening_number", "application_number", "check_number", "applicant_did",
	}
	if got := (HubBackgroundCheckConsentPayload{ApplicantDID: "x"}).Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}
