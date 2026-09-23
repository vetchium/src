package profile

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	profilespec "github.com/vetchium/src/typespec/hub/profile"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

type aliasStateQueriesStub struct {
	sqlc.Querier
	row    sqlc.GetHubAliasStateRow
	err    error
	looked bool
}

func (*aliasStateQueriesStub) AuthenticateHubSession(
	context.Context, []byte,
) (sqlc.AuthenticateHubSessionRow, error) {
	return sqlc.AuthenticateHubSessionRow{
		HubUserDid:      aliasStateUUID(1),
		HubSessionID:    aliasStateUUID(2),
		AuthenticatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}, nil
}

func (s *aliasStateQueriesStub) GetHubAliasState(
	_ context.Context, params sqlc.GetHubAliasStateParams,
) (sqlc.GetHubAliasStateRow, error) {
	if params.HubUserDid != aliasStateUUID(1) ||
		params.HubSessionID != aliasStateUUID(2) {
		return sqlc.GetHubAliasStateRow{}, errors.New("wrong owner")
	}
	s.looked = true
	return s.row, s.err
}

func aliasStateUUID(value byte) pgtype.UUID {
	return pgtype.UUID{Bytes: [16]byte{15: value}, Valid: true}
}

func TestAliasStateShowsCurrentAliasAndRollingCooldown(t *testing.T) {
	now := time.Date(2026, 9, 20, 9, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name             string
		alias            pgtype.Text
		lastChange       pgtype.Timestamptz
		wantAlias        string
		wantNextChangeAt bool
	}{
		{"new alias", pgtype.Text{String: "friendly-name", Valid: true},
			pgtype.Timestamptz{Time: now.Add(-time.Hour), Valid: true},
			"friendly-name", true},
		{"cooldown ended", pgtype.Text{String: "friendly-name", Valid: true},
			pgtype.Timestamptz{Time: now.Add(-8 * 24 * time.Hour), Valid: true},
			"friendly-name", false},
		{"no alias", pgtype.Text{}, pgtype.Timestamptz{}, "", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &aliasStateQueriesStub{row: sqlc.GetHubAliasStateRow{
				ProfileAlias: test.alias, AliasLastChangedAt: test.lastChange,
			}}
			response := callAliasState(t, db, now, true)
			if response.Code != http.StatusOK ||
				response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d cache=%q", response.Code,
					response.Header().Get("Cache-Control"))
			}
			var body profilespec.AliasState
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if test.wantAlias == "" && body.ProfileAlias != nil ||
				test.wantAlias != "" &&
					(body.ProfileAlias == nil || string(*body.ProfileAlias) != test.wantAlias) ||
				(body.NextChangeAt != nil) != test.wantNextChangeAt {
				t.Fatalf("alias state = %+v", body)
			}
		})
	}
}

func TestAliasStateHidesUnauthenticatedAndDatabaseFailures(t *testing.T) {
	now := time.Date(2026, 9, 20, 9, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name          string
		authenticated bool
		err           error
		wantStatus    int
	}{
		{"no session", false, nil, http.StatusUnauthorized},
		{"expired session", true, pgx.ErrNoRows, http.StatusUnauthorized},
		{"database error", true, errors.New("unavailable"), http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &aliasStateQueriesStub{err: test.err}
			response := callAliasState(t, db, now, test.authenticated)
			if response.Code != test.wantStatus ||
				(!test.authenticated && db.looked) {
				t.Fatalf("status=%d looked=%t", response.Code, db.looked)
			}
		})
	}
}

func callAliasState(
	t *testing.T, db *aliasStateQueriesStub, now time.Time, authenticated bool,
) *httptest.ResponseRecorder {
	t.Helper()
	s := &hubruntime.Server{
		Runtime: apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		Queries: db, Now: func() time.Time { return now },
	}
	handler := middleware.HubAuth(s)(AliasState(s))
	request := httptest.NewRequest(http.MethodGet, "/api/hub/profile/alias/state", nil)
	if authenticated {
		request.Header.Set("Authorization", "Bearer session-token")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
