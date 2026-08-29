package middleware

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	adminproblem "github.com/vetchium/src/typespec/problem/admin"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/hubapi"
)

var authenticationTestNow = time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)

type sessionStub struct {
	sqlc.Querier
	authenticatedAt time.Time
	err             error
}

func (s sessionStub) AuthenticateAdminSession(
	context.Context, []byte,
) (sqlc.AuthenticateAdminSessionRow, error) {
	if s.err != nil {
		return sqlc.AuthenticateAdminSessionRow{}, s.err
	}
	return sqlc.AuthenticateAdminSessionRow{
		AuthenticatedAt: pgtype.Timestamptz{
			Time: s.authenticatedAt, Valid: true,
		},
	}, nil
}

func (s sessionStub) AuthenticateHubSession(
	context.Context, []byte,
) (sqlc.AuthenticateHubSessionRow, error) {
	if s.err != nil {
		return sqlc.AuthenticateHubSessionRow{}, s.err
	}
	return sqlc.AuthenticateHubSessionRow{
		AuthenticatedAt: pgtype.Timestamptz{
			Time: s.authenticatedAt, Valid: true,
		},
	}, nil
}

// portalUnderTest lets one table drive both portals, so a behavior added for
// one portal and forgotten for the other fails here.
type portalUnderTest struct {
	name        string
	challenge   string
	session     func(sessionStub) func(http.Handler) http.Handler
	recent      func(sessionStub) func(http.Handler) http.Handler
	problemType string
	recentType  string
}

func testRuntime(logged *bytes.Buffer) *apiserver.Runtime {
	return apiserver.New(nil, slog.New(slog.NewTextHandler(logged, nil)))
}

func portalsUnderTest(logged *bytes.Buffer) []portalUnderTest {
	adminServer := func(db sessionStub) *adminapi.Server {
		return &adminapi.Server{
			Runtime: testRuntime(logged), Queries: db,
			Now: func() time.Time { return authenticationTestNow },
		}
	}
	hubServer := func(db sessionStub) *hubapi.Server {
		return &hubapi.Server{
			Runtime: testRuntime(logged), Queries: db,
			Now: func() time.Time { return authenticationTestNow },
		}
	}
	return []portalUnderTest{
		{
			name:      "admin",
			challenge: adminapi.BearerChallenge,
			session: func(db sessionStub) func(http.Handler) http.Handler {
				return AdminAuth(adminServer(db))
			},
			recent: func(db sessionStub) func(http.Handler) http.Handler {
				server := adminServer(db)
				return func(next http.Handler) http.Handler {
					return AdminAuth(server)(
						RequireRecentAdminAuthentication(
							server, RecentAuthenticationWindow,
						)(next),
					)
				}
			},
			problemType: adminproblem.AdminAuthenticationRequiredError.Type,
			recentType:  adminproblem.RecentAuthenticationRequiredError.Type,
		},
		{
			name:      "hub",
			challenge: hubapi.BearerChallenge,
			session: func(db sessionStub) func(http.Handler) http.Handler {
				return HubAuth(hubServer(db))
			},
			recent: func(db sessionStub) func(http.Handler) http.Handler {
				server := hubServer(db)
				return func(next http.Handler) http.Handler {
					return HubAuth(server)(
						RequireRecentHubAuthentication(
							server, RecentAuthenticationWindow,
						)(next),
					)
				}
			},
			problemType: hubproblem.AuthenticationRequiredError.Type,
			recentType:  hubproblem.RecentAuthenticationRequiredError.Type,
		},
	}
}

func serve(
	middleware func(http.Handler) http.Handler, authorization string,
) (*httptest.ResponseRecorder, bool) {
	reached := false
	handler := middleware(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			reached = true
			w.WriteHeader(http.StatusNoContent)
		},
	))
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response, reached
}

func TestPortalSessionRejectsMalformedCredentials(t *testing.T) {
	t.Parallel()
	var logged bytes.Buffer
	for _, portal := range portalsUnderTest(&logged) {
		for _, authorization := range []string{
			"", "Bearer", "Basic dXNlcjpwYXNz", "Bearer a b",
		} {
			response, reached := serve(
				portal.session(sessionStub{
					authenticatedAt: authenticationTestNow,
				}),
				authorization,
			)
			if reached || response.Code != http.StatusUnauthorized {
				t.Fatalf(
					"%s portal with %q: status = %d, reached = %t",
					portal.name, authorization, response.Code, reached,
				)
			}
			if got := response.Header().Get("WWW-Authenticate"); got !=
				portal.challenge {
				t.Fatalf("%s challenge = %q", portal.name, got)
			}
			if !strings.Contains(response.Body.String(), portal.problemType) {
				t.Fatalf("%s body = %s", portal.name, response.Body.String())
			}
		}
	}
}

func TestPortalSessionLogsAnUnknownSession(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"admin", "hub"} {
		var logged bytes.Buffer
		for _, portal := range portalsUnderTest(&logged) {
			if portal.name != name {
				continue
			}
			response, reached := serve(
				portal.session(sessionStub{err: pgx.ErrNoRows}),
				"Bearer "+strings.Repeat("a", 64),
			)
			if reached || response.Code != http.StatusUnauthorized {
				t.Fatalf(
					"%s: status = %d, reached = %t",
					portal.name, response.Code, reached,
				)
			}
			// Both portals record the failed attempt. Only the admin portal
			// used to.
			if !strings.Contains(logged.String(), "authentication_failed") ||
				!strings.Contains(logged.String(), portal.name) {
				t.Fatalf("%s log = %s", portal.name, logged.String())
			}
		}
	}
}

func TestPortalSessionSetsCacheControlAndReachesTheHandler(t *testing.T) {
	t.Parallel()
	var logged bytes.Buffer
	for _, portal := range portalsUnderTest(&logged) {
		response, reached := serve(
			portal.session(sessionStub{
				authenticatedAt: authenticationTestNow,
			}),
			"Bearer "+strings.Repeat("a", 64))
		if !reached || response.Code != http.StatusNoContent {
			t.Fatalf(
				"%s: status = %d, reached = %t",
				portal.name, response.Code, reached,
			)
		}
		if got := response.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("%s Cache-Control = %q", portal.name, got)
		}
	}
}

func TestRecentAuthenticationWindowIsEnforcedByEveryPortal(t *testing.T) {
	t.Parallel()
	var logged bytes.Buffer
	for _, portal := range portalsUnderTest(&logged) {
		for _, test := range []struct {
			name            string
			authenticatedAt time.Time
			wantReached     bool
		}{
			{
				name: "just inside the window",
				authenticatedAt: authenticationTestNow.Add(
					-RecentAuthenticationWindow,
				),
				wantReached: true,
			},
			{
				name: "just outside the window",
				authenticatedAt: authenticationTestNow.Add(
					-RecentAuthenticationWindow - time.Nanosecond,
				),
				wantReached: false,
			},
		} {
			response, reached := serve(
				portal.recent(sessionStub{
					authenticatedAt: test.authenticatedAt,
				}),
				"Bearer "+strings.Repeat("a", 64))
			if reached != test.wantReached {
				t.Fatalf(
					"%s portal, %s: reached = %t, want %t",
					portal.name, test.name, reached, test.wantReached,
				)
			}
			if test.wantReached {
				continue
			}
			if response.Code != http.StatusUnauthorized ||
				!strings.Contains(response.Body.String(), portal.recentType) {
				t.Fatalf(
					"%s portal: status = %d, body = %s",
					portal.name, response.Code, response.Body.String(),
				)
			}
			if got := response.Header().Get("WWW-Authenticate"); got !=
				portal.challenge {
				t.Fatalf("%s challenge = %q", portal.name, got)
			}
		}
	}
}
