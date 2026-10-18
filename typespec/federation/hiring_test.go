package federation

import (
	"slices"
	"strings"
	"testing"

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
	normalized := payload
	normalized.Normalize()
	if *normalized.CoverNote != "hello" || normalized.Snapshot.Websites == nil {
		t.Fatalf("unexpected normalization: %+v", normalized)
	}
	if note != "  hello " || payload.Snapshot.Websites != nil {
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
	bad.Snapshot.DisplayName = ""
	want := []string{"opening_number", "applicant_did", "cover_note", "snapshot.display_name"}
	if got := bad.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	good.CoverNote = &exact
	if got := good.Validate(); len(got) != 0 {
		t.Fatalf("5,000 code points rejected: %v", got)
	}
}
