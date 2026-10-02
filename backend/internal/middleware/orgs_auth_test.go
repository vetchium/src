package middleware

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	orgsauthorization "github.com/vetchium/src/typespec/orgs/authorization"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/db/sqlc"
	orgsruntime "backend/internal/orgs"
)

type orgSessionStub struct {
	sqlc.Querier
	state       sqlc.VetchiumOrgState
	permissions []string
}

func (s orgSessionStub) AuthenticateOrgSession(
	context.Context, []byte,
) (sqlc.AuthenticateOrgSessionRow, error) {
	return sqlc.AuthenticateOrgSessionRow{
		AuthenticatedAt: pgtype.Timestamptz{
			Time: authenticationTestNow, Valid: true,
		},
		OrgState:    s.state,
		Permissions: s.permissions,
	}, nil
}

func orgGuardChain(
	stub orgSessionStub,
	guard func(*orgsruntime.Server) func(http.Handler) http.Handler,
) func(http.Handler) http.Handler {
	server := &orgsruntime.Server{
		Runtime: testRuntime(new(bytes.Buffer)), Queries: stub,
		Now: func() time.Time { return authenticationTestNow },
	}
	return func(next http.Handler) http.Handler {
		return OrgAuth(server)(guard(server)(next))
	}
}

func TestRequireOrgPermission(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		permissions []string
		wantReached bool
	}{
		{"held", []string{"org:manage_users"}, true},
		{"implied is in the effective view", []string{
			"org:manage_billing", "org:manage_users", "org:superadmin",
		}, true},
		{"other permission", []string{"org:manage_billing"}, false},
		{"none", nil, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			chain := orgGuardChain(
				orgSessionStub{
					state:       sqlc.VetchiumOrgStateActive,
					permissions: testCase.permissions,
				},
				func(s *orgsruntime.Server) func(http.Handler) http.Handler {
					return RequireOrgPermission(
						s, orgsauthorization.ManageUsers,
					)
				},
			)
			response, reached := serve(chain, "Bearer token")
			if reached != testCase.wantReached {
				t.Fatalf("reached = %t, want %t", reached, testCase.wantReached)
			}
			if reached {
				return
			}
			if response.Code != http.StatusForbidden ||
				!strings.Contains(
					response.Body.String(),
					orgsproblem.PermissionRequiredError.Type,
				) {
				t.Fatalf("status = %d, body = %s",
					response.Code, response.Body.String())
			}
		})
	}
}

func TestRequireActiveOrgRefusesSuspendedOrg(t *testing.T) {
	t.Parallel()
	guard := func(s *orgsruntime.Server) func(http.Handler) http.Handler {
		return RequireActiveOrg(s)
	}
	active, reached := serve(orgGuardChain(
		orgSessionStub{state: sqlc.VetchiumOrgStateActive}, guard,
	), "Bearer token")
	if !reached || active.Code != http.StatusNoContent {
		t.Fatalf("active Org: status = %d, reached = %t", active.Code, reached)
	}
	suspended, reached := serve(orgGuardChain(
		orgSessionStub{state: sqlc.VetchiumOrgStateSuspended}, guard,
	), "Bearer token")
	if reached || suspended.Code != http.StatusForbidden ||
		!strings.Contains(
			suspended.Body.String(), orgsproblem.OrgSuspendedError.Type,
		) {
		t.Fatalf("suspended Org: status = %d, reached = %t, body = %s",
			suspended.Code, reached, suspended.Body.String())
	}
}

func TestOrgGuardsRequireAnIdentity(t *testing.T) {
	t.Parallel()
	server := &orgsruntime.Server{Runtime: testRuntime(new(bytes.Buffer))}
	for name, guard := range map[string]func(http.Handler) http.Handler{
		"permission": RequireOrgPermission(server, orgsauthorization.Superadmin),
		"active":     RequireActiveOrg(server),
	} {
		response, reached := serve(guard, "")
		if reached || response.Code != http.StatusUnauthorized {
			t.Fatalf("%s guard without identity: status = %d, reached = %t",
				name, response.Code, reached)
		}
	}
}
