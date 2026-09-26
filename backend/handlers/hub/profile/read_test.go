package profile

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	problemspec "github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/middleware"
	"backend/internal/profileclient"
)

const readViewerHandle = "abcde000-123456789ab"

var readViewerDID = mustParseUUID("01987aef-1234-7abc-8abc-123456789abc")
var readSessionID = mustParseUUID("01987aef-1234-7abc-8abc-123456789abd")

func mustParseUUID(value string) pgtype.UUID {
	id, err := dbvalue.ParseUUID(value)
	if err != nil {
		panic(err)
	}
	return id
}

type readQueriesStub struct {
	sqlc.Querier
}

func (*readQueriesStub) AuthenticateHubSession(
	context.Context, []byte,
) (sqlc.AuthenticateHubSessionRow, error) {
	return sqlc.AuthenticateHubSessionRow{
		HubUserDid:      readViewerDID,
		HubSessionID:    readSessionID,
		AuthenticatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}, nil
}

func (*readQueriesStub) GetHubMyInfo(
	_ context.Context, params sqlc.GetHubMyInfoParams,
) (sqlc.GetHubMyInfoRow, error) {
	return sqlc.GetHubMyInfoRow{
		HubUserDid: params.HubUserDid, Handle: readViewerHandle,
	}, nil
}

// callRead drives Read through the same HubAuth middleware production traffic
// uses, so an unauthenticated request is rejected before the handler runs.
// mesh, when non-nil, backs the RelayRead dependency; it is otherwise left
// unset so a test proving no relay call happens cannot accidentally succeed
// by reaching a real network address.
func callRead(
	t *testing.T, mesh *httptest.Server, authenticated bool, body string,
) *httptest.ResponseRecorder {
	t.Helper()
	s := &hubruntime.Server{
		Runtime: apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		Queries: &readQueriesStub{},
		Now:     time.Now,
	}
	if mesh != nil {
		s.Profiles = profileclient.NewRelay(mesh.URL, "relay-secret", time.Second)
	}
	handler := middleware.HubAuth(s)(Read(s))
	request := httptest.NewRequest(
		http.MethodPost, "/api/hub/profile/read", strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	if authenticated {
		request.Header.Set("Authorization", "Bearer session-token")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func decodeProblem(t *testing.T, response *httptest.ResponseRecorder) problemspec.Details {
	t.Helper()
	var details problemspec.Details
	if err := json.Unmarshal(response.Body.Bytes(), &details); err != nil {
		t.Fatalf("decode problem body: %v, body=%s", err, response.Body.String())
	}
	return details
}

func writeProblem(w http.ResponseWriter, details problemspec.Details) {
	w.Header().Set("Content-Type", problemspec.MediaType)
	w.WriteHeader(details.Status)
	_ = json.NewEncoder(w).Encode(details)
}

// TestReadRejectsUnauthenticated covers PROF-GEN-002: only an authenticated
// Hub user may view a profile.
func TestReadRejectsUnauthenticated(t *testing.T) {
	response := callRead(t, nil, false, `{"address":"abcde000-123456789ab"}`)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", response.Code)
	}
	details := decodeProblem(t, response)
	if details.Type != hubproblem.AuthenticationRequiredError.Type {
		t.Fatalf("problem type = %q", details.Type)
	}
	if response.Header().Get("WWW-Authenticate") != hubauthn.BearerChallenge {
		t.Fatalf("challenge = %q", response.Header().Get("WWW-Authenticate"))
	}
}

// TestReadRejectsInvalidAddress proves a malformed or empty address is
// rejected as a validation problem before any relay call is attempted.
func TestReadRejectsInvalidAddress(t *testing.T) {
	for _, test := range []struct {
		name    string
		address string
	}{
		{"empty", ""},
		{"malformed", "not a valid address!"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int32
			mesh := httptest.NewServer(http.HandlerFunc(
				func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					writeProblem(w, hubproblem.ProfileUnavailableError)
				},
			))
			defer mesh.Close()
			body, err := json.Marshal(map[string]string{"address": test.address})
			if err != nil {
				t.Fatal(err)
			}
			response := callRead(t, mesh, true, string(body))
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d", response.Code)
			}
			details := decodeProblem(t, response)
			if details.Type != problemspec.ValidationFailedError.Type {
				t.Fatalf("problem type = %q", details.Type)
			}
			found := false
			for _, field := range details.Fields {
				found = found || field == "address"
			}
			if !found {
				t.Fatalf("fields = %v", details.Fields)
			}
			if calls.Load() != 0 {
				t.Fatalf("relay was called %d times before validation passed",
					calls.Load())
			}
		})
	}
}

// TestReadRelayTransportFailureIsUnavailable covers PROF-FED-006: a mesh
// transport failure must surface as ProfileUnavailableError and must never
// fall back to a local read or an unauthenticated response.
func TestReadRelayTransportFailureIsUnavailable(t *testing.T) {
	mesh := httptest.NewServer(http.HandlerFunc(
		func(http.ResponseWriter, *http.Request) {},
	))
	mesh.Close() // Closed before use: every relay attempt fails to connect.
	response := callRead(t, mesh, true, `{"address":"abcde000-123456789ab"}`)
	if response.Code != hubproblem.ProfileUnavailableError.Status {
		t.Fatalf("status = %d", response.Code)
	}
	details := decodeProblem(t, response)
	if details.Type != hubproblem.ProfileUnavailableError.Type {
		t.Fatalf("problem type = %q", details.Type)
	}
	for _, leaked := range []string{"display_name", "handle", "work_experiences"} {
		if strings.Contains(response.Body.String(), leaked) {
			t.Fatalf("profile field %q leaked into unavailable response: %s",
				leaked, response.Body.String())
		}
	}
}

// TestReadRelayNotFoundIsSurfaced proves a ProfileNotFoundError outcome from
// the relay is passed through as not-found rather than unavailable.
func TestReadRelayNotFoundIsSurfaced(t *testing.T) {
	mesh := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			writeProblem(w, hubproblem.ProfileNotFoundError)
		},
	))
	defer mesh.Close()
	response := callRead(t, mesh, true, `{"address":"abcde000-123456789ab"}`)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d", response.Code)
	}
	details := decodeProblem(t, response)
	if details.Type != hubproblem.ProfileNotFoundError.Type {
		t.Fatalf("problem type = %q", details.Type)
	}
}

// TestReadRelayOtherProblemIsMappedToUnavailable proves the handler never
// forwards an arbitrary upstream problem verbatim to the browser.
func TestReadRelayOtherProblemIsMappedToUnavailable(t *testing.T) {
	mesh := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			writeProblem(w, hubproblem.ProfileConflictError)
		},
	))
	defer mesh.Close()
	response := callRead(t, mesh, true, `{"address":"abcde000-123456789ab"}`)
	if response.Code != hubproblem.ProfileUnavailableError.Status {
		t.Fatalf("status = %d", response.Code)
	}
	details := decodeProblem(t, response)
	if details.Type != hubproblem.ProfileUnavailableError.Type {
		t.Fatalf("problem type = %q", details.Type)
	}
	if details.Type == hubproblem.ProfileConflictError.Type {
		t.Fatal("arbitrary upstream problem was forwarded to the browser")
	}
}

// TestReadSuccessReturnsOnlyPermittedFields covers PROF-GEN-006 and
// PROF-FED-007: the wire body must carry only the Section 2 fields, checked
// from the actual response bytes rather than the decoded struct.
func TestReadSuccessReturnsOnlyPermittedFields(t *testing.T) {
	const relayBody = `{` +
		`"display_name":"Ada Lovelace",` +
		`"handle":"abcde000-123456789ab",` +
		`"profile_alias":"ada-lovelace",` +
		`"resident_country":"SG",` +
		`"profile_picture_url":"https://media.sgp.vetchium.com/pic",` +
		`"biography":"Mathematician",` +
		`"websites":[{"id":"01987aef-1234-7abc-8abc-123456789abc",` +
		`"url":"https://github.com/ada"}],` +
		`"work_experiences":[],` +
		`"certifications":[],` +
		`"language_abilities":[],` +
		`"educational_qualifications":[]` +
		`}`
	mesh := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(relayBody))
		},
	))
	defer mesh.Close()
	response := callRead(t, mesh, true, `{"address":"abcde000-123456789ab"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("cache-control = %q", response.Header().Get("Cache-Control"))
	}

	var wire map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &wire); err != nil {
		t.Fatalf("decode response body: %v", err)
	}

	permitted := map[string]bool{
		"display_name": true, "handle": true, "profile_alias": true,
		"resident_country": true, "profile_picture_url": true,
		"biography": true, "websites": true, "work_experiences": true,
		"certifications": true, "language_abilities": true,
		"educational_qualifications": true,
	}
	for key := range wire {
		if !permitted[key] {
			t.Fatalf("unexpected field %q in profile response: %s",
				key, response.Body.String())
		}
	}
	for _, forbidden := range []string{
		"account_email", "email_address", "email", "work_email",
		"professional_email", "verification", "hub_user_did", "did",
		"viewer_hub_user_did", "job_preference", "preferred_job_countries",
		"subscription", "plan", "totp", "security", "password", "recovery",
	} {
		if _, present := wire[forbidden]; present {
			t.Fatalf("forbidden field %q present in profile response: %s",
				forbidden, response.Body.String())
		}
	}
	if wire["display_name"] != "Ada Lovelace" || wire["handle"] != readViewerHandle {
		t.Fatalf("permitted fields = %+v", wire)
	}
}
