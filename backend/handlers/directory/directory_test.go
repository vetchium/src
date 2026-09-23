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
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/apiserver"
	"backend/internal/globaldirectory"
	"backend/internal/meshidentity"
)

const (
	testDID       = "018f7e32-7b5a-7d31-8fd0-f7e2a852f144"
	testCommandID = "4569b853-4778-4e67-a635-5f41b06585f5"
	testHandle    = "abcde-0123456789a"
)

type fakeService struct {
	resolveResponse directoryspec.ResolveProfileSlugResponse
	resolveErr      error
	outcome         globaldirectory.Outcome
	commandErr      error
	caller          directoryspec.TenantID
	command         string
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
				`"provisioning_expires_at":"2030-01-01T00:00:00Z"}`,
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
