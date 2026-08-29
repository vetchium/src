package hub

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	hubauth "github.com/vetchium/src/typespec/hub/auth"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/hubapi"
)

type hubDBStub struct {
	sqlc.Querier
	getUser       func(context.Context, string) (sqlc.GetHubUserForLoginRow, error)
	createSession func(context.Context, sqlc.CreateHubSessionParams) (
		sqlc.CreateHubSessionRow, error,
	)
}

func (s *hubDBStub) GetHubUserForLogin(
	ctx context.Context, email string,
) (sqlc.GetHubUserForLoginRow, error) {
	return s.getUser(ctx, email)
}

func (s *hubDBStub) CreateHubSession(
	ctx context.Context, arg sqlc.CreateHubSessionParams,
) (sqlc.CreateHubSessionRow, error) {
	return s.createSession(ctx, arg)
}

func TestLoginSessionDurations(t *testing.T) {
	now := time.Date(2026, 8, 25, 10, 0, 0, 0, time.UTC)
	passwordHash, err := credentials.HashPassword("long and unique password")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name       string
		remembered bool
		duration   time.Duration
	}{
		{name: "browser session", duration: 24 * time.Hour},
		{name: "remembered session", remembered: true, duration: 265 * 24 * time.Hour},
	} {
		t.Run(test.name, func(t *testing.T) {
			did := hubTestUUID(1)
			db := &hubDBStub{}
			db.getUser = func(
				_ context.Context, email string,
			) (sqlc.GetHubUserForLoginRow, error) {
				if email != "person@example.com" {
					t.Fatalf("normalized email = %q", email)
				}
				return sqlc.GetHubUserForLoginRow{
					HubUserDid: did, Handle: "perso-00000000001",
					PasswordHash:      passwordHash,
					HubUserState:      sqlc.VetchiumHubUserStateActive,
					PreferredLanguage: "de-DE", ResidentCountry: "DEU",
				}, nil
			}
			db.createSession = func(
				_ context.Context, arg sqlc.CreateHubSessionParams,
			) (sqlc.CreateHubSessionRow, error) {
				if arg.Remembered != test.remembered ||
					arg.ExpiresAt.Time != now.Add(test.duration) ||
					len(arg.SessionTokenHash) != 32 {
					t.Fatalf("session params = %+v", arg)
				}
				return sqlc.CreateHubSessionRow{ExpiresAt: arg.ExpiresAt}, nil
			}
			body := `{"email_address":" PERSON@example.com ",` +
				`"password":"long and unique password","remember_me":` +
				map[bool]string{false: "false", true: "true"}[test.remembered] + `}`
			response := hubJSONRequest(t, Login(hubTestServer(db, now)), body)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			var payload hubauth.LoginAuthenticatedResponse
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			if payload.SessionExpiresAt != now.Add(test.duration) ||
				payload.PreferredLanguage != "de-DE" ||
				payload.ResidentCountry != "DEU" || len(payload.SessionToken) < 32 {
				t.Fatalf("response = %+v", payload)
			}
		})
	}
}

func TestLoginValidatesRequest(t *testing.T) {
	response := hubJSONRequest(
		t, Login(hubTestServer(&hubDBStub{}, time.Now())),
		`{"email_address":"invalid","password":""}`,
	)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != problem.MediaType {
		t.Fatalf("content type = %q", response.Header().Get("Content-Type"))
	}
	var details problem.Details
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	if details.Type != "vetchium-problem-details/validation-failed" ||
		len(details.Fields) != 2 {
		t.Fatalf("problem = %+v", details)
	}
}

func hubJSONRequest(
	t *testing.T, handler http.Handler, body string,
) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(
		http.MethodPost, "/api/hub/login", bytes.NewBufferString(body),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func hubTestServer(db sqlc.Querier, now time.Time) *hubapi.Server {
	return &hubapi.Server{
		Runtime: apiserver.New(
			nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
		),
		Queries: db, TenantID: "test",
		SessionDurations: apiserver.SessionDurations{
			Default: 24 * time.Hour, Remembered: 265 * 24 * time.Hour,
		},
		CredentialKey: hubapi.DeriveCredentialKey("test", "secret"),
		Now:           func() time.Time { return now },
	}
}

func hubTestUUID(last byte) pgtype.UUID {
	value := [16]byte{6: 0x70, 8: 0x80, 15: last}
	return pgtype.UUID{Bytes: value, Valid: true}
}
