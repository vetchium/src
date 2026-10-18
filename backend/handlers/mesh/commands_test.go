package mesh

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

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/apiserver"
	"backend/internal/directoryclient"
	"backend/internal/federation/commands"
	"backend/internal/meshapi"
)

const (
	testAuthorityDID = "018f7e32-7b5a-7d31-8fd0-f7e2a852f144"
	testCredential   = "relay-secret"
)

func testCommandBody(did string) string {
	return `{"command_id":"f4847331-5a4f-4eae-a5f4-cc131b0cd270",` +
		`"correlation_id":"0d3b2a35-5f1c-4f5e-9d47-0a5b7f2e9c11",` +
		`"kind":"test-command","authority_principal_type":"org",` +
		`"authority_principal_did":"` + did + `","aggregate_id":"aggregate",` +
		`"payload":{"value":1}}`
}

// fakeCoordinator homes testAuthorityDID at home and knows no other DID.
func fakeCoordinator(t *testing.T, home string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			var request directoryspec.ResolvePrincipalRequest
			if r.URL.Path != "/directory/resolve-principal" ||
				json.NewDecoder(r.Body).Decode(&request) != nil {
				t.Errorf("coordinator request %s", r.URL.Path)
			}
			if request.PrincipalDID != testAuthorityDID {
				w.Header().Set("Content-Type", problem.MediaType)
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(
					coordinatorproblem.DirectoryEntryNotFoundError,
				)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(directoryspec.ResolvePrincipalResponse{
				PrincipalType: request.PrincipalType,
				PrincipalDID:  request.PrincipalDID,
				HomeTenantID:  directoryspec.TenantID(home), RoutingVersion: 1,
			})
		},
	))
	t.Cleanup(server.Close)
	return server
}

type peersStub struct {
	outcome commands.PeerOutcome
	err     error
	tenant  directoryspec.TenantID
}

func (p *peersStub) Execute(
	_ context.Context, tenant directoryspec.TenantID,
	_ federationspec.ExecuteCommandRequest,
) (commands.PeerOutcome, error) {
	p.tenant = tenant
	return p.outcome, p.err
}

func relayServer(
	coordinatorURL string, peers meshapi.CommandPeers,
) *meshapi.Server {
	return &meshapi.Server{
		Runtime: apiserver.New(
			nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
		),
		TenantID:   "sgp",
		Credential: testCredential,
		Directory: directoryclient.New(
			coordinatorURL, "/directory", "", time.Second,
		),
		CommandPeers: peers,
	}
}

func relayCall(
	s *meshapi.Server, body string, credential string,
) *httptest.ResponseRecorder {
	request := httptest.NewRequest(
		http.MethodPost, "/mesh/commands/execute", strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	if credential != "" {
		request.Header.Set("Authorization", "Bearer "+credential)
	}
	recorder := httptest.NewRecorder()
	RelayExecuteCommand(s)(recorder, request)
	return recorder
}

func problemType(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var details problem.Details
	if err := json.Unmarshal(recorder.Body.Bytes(), &details); err != nil {
		t.Fatalf("problem body %q: %v", recorder.Body, err)
	}
	return details.Type
}

func TestRelayExecuteCommandRoutesAndClassifies(t *testing.T) {
	t.Parallel()
	result := commands.Response{
		Status: 201, Body: json.RawMessage(`{"id":"x"}`),
	}
	conflict := federationproblem.CommandConflictError
	misdirected := federationproblem.AuthorityMisdirectedError
	validation := problem.ValidationFailedError
	validation.Fields = []string{"kind"}
	teapot := problem.Details{Type: "x/other", Status: 418}
	for _, test := range []struct {
		name    string
		did     string
		peers   *peersStub
		status  int
		problem string
	}{
		{
			name: "remote result", did: testAuthorityDID,
			peers:  &peersStub{outcome: commands.PeerOutcome{Result: &result}},
			status: 200,
		},
		{
			name: "unknown authority", did: "018f7e32-7b5a-7d31-8fd0-aaaaaaaaaaaa",
			peers: &peersStub{}, status: 404,
			problem: federationproblem.AuthorityNotFoundError.Type,
		},
		{
			name: "peer unreachable", did: testAuthorityDID,
			peers:  &peersStub{err: commands.ErrNotSent},
			status: 503, problem: federationproblem.AuthorityUnavailableError.Type,
		},
		{
			name: "peer outcome unknown", did: testAuthorityDID,
			peers:  &peersStub{err: commands.ErrOutcomeUnknown},
			status: 504, problem: federationproblem.CommandOutcomeUnknownError.Type,
		},
		{
			name: "peer conflict", did: testAuthorityDID,
			peers:  &peersStub{outcome: commands.PeerOutcome{Problem: &conflict}},
			status: 409, problem: conflict.Type,
		},
		{
			name: "peer misdirected", did: testAuthorityDID,
			peers:  &peersStub{outcome: commands.PeerOutcome{Problem: &misdirected}},
			status: 421, problem: misdirected.Type,
		},
		{
			name: "peer unknown kind", did: testAuthorityDID,
			peers:  &peersStub{outcome: commands.PeerOutcome{Problem: &validation}},
			status: 400, problem: validation.Type,
		},
		{
			name: "undeclared peer problem", did: testAuthorityDID,
			peers:  &peersStub{outcome: commands.PeerOutcome{Problem: &teapot}},
			status: 504, problem: federationproblem.CommandOutcomeUnknownError.Type,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			s := relayServer(fakeCoordinator(t, "usa1").URL, test.peers)
			recorder := relayCall(s, testCommandBody(test.did), testCredential)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
			}
			if test.problem != "" && problemType(t, recorder) != test.problem {
				t.Fatalf("problem = %s", recorder.Body)
			}
			if test.status == 200 {
				if test.peers.tenant != "usa1" ||
					recorder.Header().Get("Cache-Control") != "no-store" ||
					recorder.Body.String() != `{"status":201,"body":{"id":"x"}}` {
					t.Fatalf("routed to %q: %v %s", test.peers.tenant,
						recorder.Header(), recorder.Body)
				}
			}
			if test.status == 400 && !strings.Contains(
				recorder.Body.String(), `"kind"`) {
				t.Fatalf("validation fields lost: %s", recorder.Body)
			}
		})
	}
}

func TestRelayExecuteCommandRefusesBeforeRouting(t *testing.T) {
	t.Parallel()
	peers := &peersStub{}
	s := relayServer(fakeCoordinator(t, "usa1").URL, peers)
	for _, test := range []struct {
		name       string
		body       string
		credential string
		status     int
		problem    string
	}{
		{
			name: "missing credential", body: testCommandBody(testAuthorityDID),
			status:  401,
			problem: coordinatorproblem.MeshRelayAuthenticationRequiredError.Type,
		},
		{
			name: "wrong credential", body: testCommandBody(testAuthorityDID),
			credential: "wrong", status: 401,
			problem: coordinatorproblem.MeshRelayAuthenticationRequiredError.Type,
		},
		{
			name: "malformed", body: `{`, credential: testCredential,
			status: 400, problem: problem.InvalidJSONError.Type,
		},
		{
			name: "invalid", body: strings.Replace(
				testCommandBody(testAuthorityDID), `"test-command"`, `"Bad"`, 1,
			),
			credential: testCredential, status: 400,
			problem: problem.ValidationFailedError.Type,
		},
	} {
		recorder := relayCall(s, test.body, test.credential)
		if recorder.Code != test.status || problemType(t, recorder) != test.problem {
			t.Errorf("%s: %d %s", test.name, recorder.Code, recorder.Body)
		}
	}
	if peers.tenant != "" {
		t.Fatal("a refused command reached a peer")
	}
}

func TestRelayExecuteCommandDirectoryOutageIsNotSent(t *testing.T) {
	t.Parallel()
	coordinator := fakeCoordinator(t, "usa1")
	coordinator.Close()
	peers := &peersStub{}
	recorder := relayCall(
		relayServer(coordinator.URL, peers),
		testCommandBody(testAuthorityDID), testCredential,
	)
	if recorder.Code != 503 || problemType(t, recorder) !=
		federationproblem.AuthorityUnavailableError.Type || peers.tenant != "" {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
}

func TestPeerExecuteCommandRequiresTenantIdentity(t *testing.T) {
	t.Parallel()
	s := relayServer("http://127.0.0.1:1", &peersStub{})
	request := httptest.NewRequest(http.MethodPost,
		"/api/mesh/commands/execute",
		strings.NewReader(testCommandBody(testAuthorityDID)))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	PeerExecuteCommand(s)(recorder, request)
	if recorder.Code != 401 ||
		recorder.Header().Get("WWW-Authenticate") != `MutualTLS realm="mesh-api"` ||
		problemType(t, recorder) !=
			coordinatorproblem.MeshPeerAuthenticationRequiredError.Type {
		t.Fatalf("status = %d, headers = %v, body = %s",
			recorder.Code, recorder.Header(), recorder.Body)
	}
}
