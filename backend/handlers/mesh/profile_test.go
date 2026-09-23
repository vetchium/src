package mesh

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	profilespec "github.com/vetchium/src/typespec/hub/profile"

	"backend/internal/db/sqlc"
)

type pictureSignerStub struct {
	url string
}

func (s pictureSignerStub) SignGet(context.Context, pgtype.UUID) (string, error) {
	return s.url, nil
}

func TestPublicProfileProjectionExcludesPrivateData(t *testing.T) {
	row := sqlc.GetHubPublicProfileRow{
		DisplayName: "Ada", Handle: "abcde-123456789ab",
		ResidentCountry: "SG",
		WorkExperiences: []byte(`[{"id":"01987aef-1234-7abc-8abc-123456789abc",` +
			`"employer_domain":"example.com","job_title":"Engineer",` +
			`"start_month":"2020-06"}]`),
		Certifications:            []byte(`[]`),
		LanguageAbilities:         []byte(`[]`),
		EducationalQualifications: []byte(`[]`),
	}
	profile, err := publicProfileFromRow(context.Background(), row, nil)
	if err != nil || len(profile.WorkExperiences) != 1 ||
		profile.WorkExperiences[0].StartMonth != "2020-06" {
		t.Fatalf("projection = %+v, %v", profile, err)
	}
	encoded, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	for _, privateField := range []string{
		"hub_user_did", "email_address", "first_verified_at",
		"last_verified_at", "profile_version",
	} {
		if strings.Contains(string(encoded), privateField) {
			t.Fatalf("private field %s leaked: %s", privateField, encoded)
		}
	}
	row.ProfilePictureObjectID = pgtype.UUID{Valid: true}
	if _, err := publicProfileFromRow(context.Background(), row, nil); err == nil {
		t.Fatal("picture without a signed URL was silently omitted")
	}
	const signedURL = "https://media.sgp.vetchium.com/hub-profile-pictures/object?X-Amz-Signature=abc"
	profile, err = publicProfileFromRow(context.Background(), row,
		pictureSignerStub{url: signedURL})
	if err != nil || profile.ProfilePictureURL == nil ||
		*profile.ProfilePictureURL != signedURL {
		t.Fatalf("signed profile picture projection = %+v, %v", profile, err)
	}
}

func TestPeerViewerMustBeHomedByCertificateTenant(t *testing.T) {
	const viewer = "01987aef-1234-7abc-8abc-123456789abc"
	const handle = "abcde-123456789ab"
	request := profilespec.PeerReadProfileRequest{
		ViewerHubUserDID: viewer,
		ViewerHandle:     handle,
	}
	resolved := directoryspec.ResolveProfileSlugResponse{
		HubUserDID:   viewer,
		Slug:         handle,
		Kind:         directoryspec.ProfileSlugKindHandle,
		HomeTenantID: "sgp",
	}
	if !viewerBelongsToCaller(resolved, request, "sgp") {
		t.Fatal("correct tenant and permanent identity were denied")
	}
	if viewerBelongsToCaller(resolved, request, "deu") {
		t.Fatal("wrong caller tenant was accepted")
	}
	resolved.Kind = directoryspec.ProfileSlugKindAlias
	if viewerBelongsToCaller(resolved, request, "sgp") {
		t.Fatal("alias was accepted as permanent viewer handle")
	}
	resolved.Kind = directoryspec.ProfileSlugKindHandle
	resolved.HubUserDID = "01987aef-1234-7abc-8abc-123456789abd"
	if viewerBelongsToCaller(resolved, request, "sgp") {
		t.Fatal("mismatched viewer DID was accepted")
	}
}

func TestResolvedAliasMustMatchEffectiveHomeProfile(t *testing.T) {
	alias := directoryspec.HubAlias("friendly-name")
	profile := profilespec.PublicProfile{
		Handle: "abcde-123456789ab", ProfileAlias: &alias,
	}
	resolved := directoryspec.ResolveProfileSlugResponse{
		Slug: string(alias), Kind: directoryspec.ProfileSlugKindAlias,
	}
	if !profileMatchesResolvedSlug(profile, resolved) {
		t.Fatal("effective alias was rejected")
	}
	profile.ProfileAlias = nil
	if profileMatchesResolvedSlug(profile, resolved) {
		t.Fatal("directory-only alias survived local entitlement removal")
	}
	resolved.Kind = directoryspec.ProfileSlugKindHandle
	resolved.Slug = string(profile.Handle)
	if !profileMatchesResolvedSlug(profile, resolved) {
		t.Fatal("permanent handle was rejected")
	}
	resolved.Slug = "other-123456789ab"
	if profileMatchesResolvedSlug(profile, resolved) {
		t.Fatal("stale directory handle was accepted")
	}
}
