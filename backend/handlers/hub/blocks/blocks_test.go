package blocks

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/directoryclient"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

const (
	callerDID = "01987aef-1234-7abc-8abc-123456789abc"
	otherDID  = "01987aef-1234-7abc-8abc-123456789abd"
)

type queriesStub struct {
	sqlc.Querier
	writes int
}

func (*queriesStub) AuthenticateHubSession(
	context.Context, []byte,
) (sqlc.AuthenticateHubSessionRow, error) {
	return sqlc.AuthenticateHubSessionRow{
		HubUserDid:      callerUUID(),
		HubSessionID:    pgtype.UUID{Bytes: [16]byte{15: 9}, Valid: true},
		AuthenticatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}, nil
}

func (q *queriesStub) InsertHubUserBlock(
	context.Context, sqlc.InsertHubUserBlockParams,
) (sqlc.InsertHubUserBlockRow, error) {
	q.writes++
	return sqlc.InsertHubUserBlockRow{}, nil
}

// directory resolves "other-handle" to otherDID and "my-handle" to callerDID.
func directory(t *testing.T) *directoryclient.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			var request directoryspec.ResolveProfileSlugRequest
			_ = json.NewDecoder(r.Body).Decode(&request)
			did := map[string]string{
				"abcde000-000000000aa": callerDID,
				"abcde000-000000000bb": otherDID,
			}[request.Slug]
			if did == "" {
				w.Header().Set("Content-Type", problem.MediaType)
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(
					coordinatorproblem.DirectoryEntryNotFoundError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(directoryspec.ResolveProfileSlugResponse{
				HubUserDID: hubspec.HubUserDID(did), Slug: request.Slug,
				Kind: directoryspec.ProfileSlugKindHandle, HomeTenantID: "sgp",
				RoutingVersion: 1,
			})
		}))
	t.Cleanup(server.Close)
	return directoryclient.New(server.URL, "/directory", "", time.Second)
}

func call(
	t *testing.T, body string,
) (*httptest.ResponseRecorder, *queriesStub) {
	t.Helper()
	db := &queriesStub{}
	s := &hubruntime.Server{
		Runtime:   apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		Queries:   db,
		Directory: directory(t),
	}
	handler := middleware.HubAuth(s)(Block(s))
	request := httptest.NewRequest(
		http.MethodPost, "/api/hub/blocks/block", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer session-token")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response, db
}

func TestBlockRejectsInvalidRequests(t *testing.T) {
	for _, test := range []struct{ name, body string }{
		{"malformed JSON", `{`},
		{"missing user", `{}`},
		{"invalid address", `{"user":"!"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			response, db := call(t, test.body)
			if response.Code != http.StatusBadRequest || db.writes != 0 {
				t.Fatalf("status %d, writes %d: %s",
					response.Code, db.writes, response.Body)
			}
		})
	}
}

func TestBlockRefusesSelfAndUnknownUsers(t *testing.T) {
	response, db := call(t, `{"user":"abcde000-000000000aa"}`)
	if response.Code != http.StatusBadRequest ||
		!strings.Contains(response.Body.String(), `"user"`) || db.writes != 0 {
		t.Fatalf("self: status %d, writes %d: %s",
			response.Code, db.writes, response.Body)
	}
	response, db = call(t, `{"user":"abcde000-000000000cc"}`)
	if response.Code != http.StatusNotFound || db.writes != 0 {
		t.Fatalf("unknown: status %d, writes %d: %s",
			response.Code, db.writes, response.Body)
	}
	response, db = call(t, `{"user":"abcde000-000000000bb"}`)
	if response.Code != http.StatusNoContent || db.writes != 1 {
		t.Fatalf("other: status %d, writes %d: %s",
			response.Code, db.writes, response.Body)
	}
}

func callerUUID() pgtype.UUID {
	id, err := dbvalue.ParseUUID(callerDID)
	if err != nil {
		panic(err)
	}
	return id
}
