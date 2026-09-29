package directory

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/apiserver"
	"backend/internal/globaldirectory"
	"backend/internal/meshidentity"
)

const (
	testDID         = "018f7e32-7b5a-7d31-8fd0-f7e2a852f144"
	testCommandID   = "4569b853-4778-4e67-a635-5f41b06585f5"
	testHandle      = "abcde000-0123456789a"
	testEmailDigest = "bee57e69a23d800d7718d0e79b2be1519e131232967431dba85e2737b6621f6e"
)

const testDigestKeyID = "909577e87ebd5395"

type fakeService struct {
	resolveResponse      directoryspec.ResolveProfileSlugResponse
	resolveErr           error
	outcome              globaldirectory.Outcome
	orgResolve           directoryspec.ResolveOrgDomainResponse
	orgOutcome           globaldirectory.OrgOutcome
	emailChangeOutcome   globaldirectory.EmailChangeOutcome
	resolveEmailResponse directoryspec.ResolveHubAccountEmailResponse
	resolveEmailProblem  *problem.Details
	commandErr           error
	caller               directoryspec.TenantID
	command              string
}

func (f *fakeService) ResolveProfileSlug(
	context.Context, string,
) (directoryspec.ResolveProfileSlugResponse, error) {
	return f.resolveResponse, f.resolveErr
}

func (f *fakeService) ReserveHubPrincipal(
	_ context.Context, caller directoryspec.TenantID,
	_ directoryspec.ReserveHubPrincipalRequest,
) (globaldirectory.Outcome, error) {
	f.caller, f.command = caller, "reserve"
	return f.outcome, f.commandErr
}

func (f *fakeService) ActivateHubPrincipal(
	_ context.Context, caller directoryspec.TenantID,
	_ directoryspec.ActivateHubPrincipalRequest,
) (globaldirectory.Outcome, error) {
	f.caller, f.command = caller, "activate"
	return f.outcome, f.commandErr
}

func (f *fakeService) SetHubAlias(
	_ context.Context, caller directoryspec.TenantID,
	_ directoryspec.SetHubAliasRequest,
) (globaldirectory.Outcome, error) {
	f.caller, f.command = caller, "alias"
	return f.outcome, f.commandErr
}

func (f *fakeService) ResolveOrgDomain(
	context.Context, orgs.OrgDomain,
) (directoryspec.ResolveOrgDomainResponse, error) {
	return f.orgResolve, f.resolveErr
}

func (f *fakeService) ReserveOrgPrincipal(
	_ context.Context, caller directoryspec.TenantID,
	_ directoryspec.ReserveOrgPrincipalRequest,
) (globaldirectory.OrgOutcome, error) {
	f.caller, f.command = caller, "reserve-org"
	return f.orgOutcome, f.commandErr
}

func (f *fakeService) ActivateOrgPrincipal(
	_ context.Context, caller directoryspec.TenantID,
	_ directoryspec.ActivateOrgPrincipalRequest,
) (globaldirectory.OrgOutcome, error) {
	f.caller, f.command = caller, "activate-org"
	return f.orgOutcome, f.commandErr
}

func (f *fakeService) ReleaseOrgDomain(
	_ context.Context, caller directoryspec.TenantID,
	_ directoryspec.ReleaseOrgDomainRequest,
) (globaldirectory.OrgOutcome, error) {
	f.caller, f.command = caller, "release-org-domain"
	return f.orgOutcome, f.commandErr
}

func (f *fakeService) ClaimOrgDomain(
	_ context.Context, caller directoryspec.TenantID,
	_ directoryspec.ClaimOrgDomainRequest,
) (globaldirectory.OrgOutcome, error) {
	f.caller, f.command = caller, "claim-org-domain"
	return f.orgOutcome, f.commandErr
}

func (f *fakeService) ResolveHubAccountEmail(
	context.Context, directoryspec.ResolveHubAccountEmailRequest,
) (directoryspec.ResolveHubAccountEmailResponse, *problem.Details, error) {
	return f.resolveEmailResponse, f.resolveEmailProblem, f.resolveErr
}

func (f *fakeService) ReserveHubAccountEmailChange(
	_ context.Context, caller directoryspec.TenantID,
	_ directoryspec.ReserveHubAccountEmailChangeRequest,
) (globaldirectory.EmailChangeOutcome, error) {
	f.caller, f.command = caller, "reserve-email-change"
	return f.emailChangeOutcome, f.commandErr
}

func (f *fakeService) FinalizeHubAccountEmailChange(
	_ context.Context, caller directoryspec.TenantID,
	_ directoryspec.FinalizeHubAccountEmailChangeRequest,
) (globaldirectory.EmailChangeOutcome, error) {
	f.caller, f.command = caller, "finalize-email-change"
	return f.emailChangeOutcome, f.commandErr
}

func (f *fakeService) AbandonHubAccountEmailChange(
	_ context.Context, caller directoryspec.TenantID,
	_ directoryspec.AbandonHubAccountEmailChangeRequest,
) (globaldirectory.EmailChangeOutcome, error) {
	f.caller, f.command = caller, "abandon-email-change"
	return f.emailChangeOutcome, f.commandErr
}

func TestResolveProfileSlugHandler(t *testing.T) {
	t.Parallel()
	response := directoryspec.ResolveProfileSlugResponse{
		HubUserDID: testDID, Slug: testHandle,
		Kind:         directoryspec.ProfileSlugKindHandle,
		HomeTenantID: "ind1", RoutingVersion: 1,
	}
	for _, test := range []struct {
		name       string
		authorized bool
		body       string
		err        error
		status     int
	}{
		{
			name: "success", authorized: true,
			body: `{"slug":"` + testHandle + `"}`, status: 200,
		},
		{
			name: "missing", authorized: true,
			body: `{"slug":"` + testHandle + `"}`,
			err:  globaldirectory.ErrNotFound, status: 404,
		},
		{
			name: "invalid slug", authorized: true,
			body: `{"slug":"--bad"}`, status: 400,
		},
		{
			name: "unauthenticated",
			body: `{"slug":"` + testHandle + `"}`, status: 401,
		},
		{
			name: "database failure", authorized: true,
			body: `{"slug":"` + testHandle + `"}`,
			err:  fmt.Errorf("offline"), status: 500,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			service := &fakeService{
				resolveResponse: response, resolveErr: test.err,
			}
			recorder := serve(
				t, test.authorized, test.body,
				ResolveProfileSlug(testRuntime(), service),
			)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
			}
			if test.status == 200 &&
				recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing no-store response policy")
			}
			if test.status == 401 &&
				recorder.Header().Get("WWW-Authenticate") !=
					authenticationChallenge {
				t.Fatal("missing mutual TLS challenge")
			}
		})
	}
}

func TestCommandHandlers(t *testing.T) {
	t.Parallel()
	principal := directoryspec.PrincipalCommandResponse{
		HubUserDID: hub.HubUserDID(testDID),
		Handle:     hub.HubHandle(testHandle), HomeTenantID: "ind1",
		RoutingVersion: 1, State: directoryspec.PrincipalActive,
	}
	alias := directoryspec.HubAlias("mary-jane")
	for _, test := range []struct {
		name, body, wantCommand string
		handler                 func(*apiserver.Runtime, Service) http.HandlerFunc
	}{
		{
			name: "reserve", wantCommand: "reserve",
			body: `{"command_id":"` + testCommandID + `",` +
				`"hub_user_did":"` + testDID + `",` +
				`"handle":"` + testHandle + `",` +
				`"home_tenant_id":"ind1",` +
				`"provisioning_expires_at":"2030-01-01T00:00:00Z",` +
				`"account_email_digest":"` + testEmailDigest + `",` +
				`"digest_key_id":"` + testDigestKeyID + `"}`,
			handler: ReserveHubPrincipal,
		},
		{
			name: "activate", wantCommand: "activate",
			body: `{"command_id":"` + testCommandID + `",` +
				`"hub_user_did":"` + testDID + `"}`,
			handler: ActivateHubPrincipal,
		},
		{
			name: "alias", wantCommand: "alias",
			body: `{"command_id":"` + testCommandID + `",` +
				`"hub_user_did":"` + testDID + `",` +
				`"profile_alias":"` + string(alias) + `"}`,
			handler: SetHubAlias,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			service := &fakeService{outcome: globaldirectory.Outcome{
				Status: http.StatusOK, Principal: &principal,
			}}
			recorder := serve(
				t, true, test.body, test.handler(testRuntime(), service),
			)
			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
			}
			if service.command != test.wantCommand || service.caller != "ind1" {
				t.Fatalf(
					"command = %q, caller = %q", service.command, service.caller,
				)
			}
		})
	}
}

func TestCommandHandlerProblemAndFailure(t *testing.T) {
	t.Parallel()
	body := `{"command_id":"` + testCommandID + `",` +
		`"hub_user_did":"` + testDID + `"}`
	problemService := &fakeService{outcome: globaldirectory.Outcome{
		Status: 409, Problem: &coordinatorproblem.DirectoryStateConflictError,
	}}
	recorder := serve(
		t, true, body, ActivateHubPrincipal(testRuntime(), problemService),
	)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("problem status = %d, body = %s", recorder.Code, recorder.Body)
	}
	failingService := &fakeService{commandErr: fmt.Errorf("offline")}
	recorder = serve(
		t, true, body, ActivateHubPrincipal(testRuntime(), failingService),
	)
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("failure status = %d, body = %s", recorder.Code, recorder.Body)
	}
}

func serve(
	t *testing.T, authorized bool, body string, handler http.Handler,
) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if authorized {
		request = request.WithContext(meshidentity.WithTenant(
			request.Context(), "ind1",
		))
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func testRuntime() *apiserver.Runtime {
	return apiserver.New(nil, slog.Default())
}

func TestResolveOrgDomainHandler(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name       string
		authorized bool
		body       string
		err        error
		status     int
	}{
		{
			name: "success", authorized: true,
			body: `{"domain":"Example.COM"}`, status: 200,
		},
		{
			name: "missing", authorized: true, body: `{"domain":"example.com"}`,
			err: globaldirectory.ErrNotFound, status: 404,
		},
		{
			name: "invalid domain", authorized: true,
			body: `{"domain":"localhost"}`, status: 400,
		},
		{name: "unauthenticated", body: `{"domain":"example.com"}`, status: 401},
		{
			name: "database failure", authorized: true,
			body: `{"domain":"example.com"}`,
			err:  fmt.Errorf("offline"), status: 500,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			service := &fakeService{
				orgResolve: directoryspec.ResolveOrgDomainResponse{
					OrgDID: testDID, Domain: "example.com",
					HomeTenantID: "ind1", RoutingVersion: 1,
				},
				resolveErr: test.err,
			}
			recorder := serve(
				t, test.authorized, test.body,
				ResolveOrgDomain(testRuntime(), service),
			)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
			}
		})
	}
}

func TestOrgCommandHandlers(t *testing.T) {
	t.Parallel()
	domain := orgs.OrgDomain("example.com")
	response := directoryspec.OrgPrincipalCommandResponse{
		OrgDID: testDID, Domain: &domain, HomeTenantID: "ind1",
		RoutingVersion: 1, State: directoryspec.PrincipalActive,
	}
	identity := `"command_id":"` + testCommandID + `","org_did":"` + testDID + `"`
	for _, test := range []struct {
		name, body, wantCommand string
		handler                 func(*apiserver.Runtime, Service) http.HandlerFunc
	}{
		{
			name: "reserve", wantCommand: "reserve-org",
			body: `{` + identity + `,"domain":"example.com",` +
				`"home_tenant_id":"ind1",` +
				`"provisioning_expires_at":"2030-01-01T00:00:00Z"}`,
			handler: ReserveOrgPrincipal,
		},
		{
			name: "activate", wantCommand: "activate-org",
			body: `{` + identity + `}`, handler: ActivateOrgPrincipal,
		},
		{
			name: "release", wantCommand: "release-org-domain",
			body:    `{` + identity + `,"domain":"example.com"}`,
			handler: ReleaseOrgDomain,
		},
		{
			name: "claim", wantCommand: "claim-org-domain",
			body:    `{` + identity + `,"domain":"example.com"}`,
			handler: ClaimOrgDomain,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			service := &fakeService{orgOutcome: globaldirectory.OrgOutcome{
				Status: http.StatusOK, Org: &response,
			}}
			recorder := serve(
				t, true, test.body, test.handler(testRuntime(), service),
			)
			if recorder.Code != http.StatusOK ||
				!strings.Contains(recorder.Body.String(), `"domain":"example.com"`) {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
			}
			if service.command != test.wantCommand || service.caller != "ind1" {
				t.Fatalf(
					"command = %q, caller = %q", service.command, service.caller,
				)
			}
		})
	}
	conflict := &fakeService{orgOutcome: globaldirectory.OrgOutcome{
		Status: 409, Problem: &coordinatorproblem.DirectoryClaimConflictError,
	}}
	recorder := serve(
		t, true, `{`+identity+`,"domain":"example.com"}`,
		ClaimOrgDomain(testRuntime(), conflict),
	)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("claim conflict status = %d", recorder.Code)
	}
}

func TestResolveHubAccountEmailHandler(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name       string
		authorized bool
		err        error
		problem    *problem.Details
		status     int
	}{
		{name: "success", authorized: true, status: 200},
		{
			name: "missing", authorized: true,
			err: globaldirectory.ErrNotFound, status: 404,
		},
		{name: "unauthenticated", status: 401},
		{
			name: "digest key mismatch", authorized: true,
			problem: &coordinatorproblem.DirectoryDigestKeyMismatchError,
			status:  409,
		},
		{
			name: "database failure", authorized: true,
			err: fmt.Errorf("offline"), status: 500,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			service := &fakeService{
				resolveEmailResponse: directoryspec.ResolveHubAccountEmailResponse{
					HomeTenantID: "ind1",
				},
				resolveEmailProblem: test.problem, resolveErr: test.err,
			}
			body := `{"email_digest":"` + testEmailDigest + `",` +
				`"digest_key_id":"` + testDigestKeyID + `"}`
			recorder := serve(
				t, test.authorized, body,
				ResolveHubAccountEmail(testRuntime(), service),
			)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
			}
		})
	}
}

func TestEmailChangeCommandHandlers(t *testing.T) {
	t.Parallel()
	response := directoryspec.HubAccountEmailChangeReservationResponse{
		State: directoryspec.EmailChangeReserved,
	}
	reserveBody := `{"command_id":"` + testCommandID + `",` +
		`"change_id":"` + testCommandID + `",` +
		`"hub_user_did":"` + testDID + `",` +
		`"new_email_digest":"` + testEmailDigest + `",` +
		`"not_after":"2030-01-01T00:00:00Z",` +
		`"digest_key_id":"` + testDigestKeyID + `"}`
	simpleBody := `{"command_id":"` + testCommandID + `",` +
		`"change_id":"` + testCommandID + `",` +
		`"hub_user_did":"` + testDID + `"}`
	abandonBody := `{"command_id":"` + testCommandID + `",` +
		`"change_id":"` + testCommandID + `",` +
		`"hub_user_did":"` + testDID + `",` +
		`"not_after":"2030-01-01T00:00:00Z"}`
	for _, test := range []struct {
		name, body, wantCommand string
		handler                 func(*apiserver.Runtime, Service) http.HandlerFunc
	}{
		{
			name: "reserve", wantCommand: "reserve-email-change",
			body: reserveBody, handler: ReserveHubAccountEmailChange,
		},
		{
			name: "finalize", wantCommand: "finalize-email-change",
			body: simpleBody, handler: FinalizeHubAccountEmailChange,
		},
		{
			name: "abandon", wantCommand: "abandon-email-change",
			body: abandonBody, handler: AbandonHubAccountEmailChange,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			service := &fakeService{
				emailChangeOutcome: globaldirectory.EmailChangeOutcome{
					Status: http.StatusOK, Reservation: &response,
				},
			}
			recorder := serve(
				t, true, test.body, test.handler(testRuntime(), service),
			)
			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
			}
			if service.command != test.wantCommand || service.caller != "ind1" {
				t.Fatalf(
					"command = %q, caller = %q", service.command, service.caller,
				)
			}
		})
	}

	conflict := &fakeService{emailChangeOutcome: globaldirectory.EmailChangeOutcome{
		Status:  409,
		Problem: &coordinatorproblem.DirectoryReservationExpiredError,
	}}
	recorder := serve(
		t, true, reserveBody,
		ReserveHubAccountEmailChange(testRuntime(), conflict),
	)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("reservation-expired status = %d", recorder.Code)
	}
}
