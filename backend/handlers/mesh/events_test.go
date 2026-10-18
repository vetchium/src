package mesh

import (
	"context"
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
	"backend/internal/federation/events"
	"backend/internal/federation/meshwire"
	"backend/internal/meshapi"
)

func testEventBody(did string) string {
	return `{"event_id":"f4847331-5a4f-4eae-a5f4-cc131b0cd270",` +
		`"kind":"test-event","destination_principal_type":"org",` +
		`"destination_principal_did":"` + did + `",` +
		`"aggregate_type":"test_aggregate","aggregate_id":"aggregate",` +
		`"aggregate_version":2,"payload":{"value":1}}`
}

type eventPeersStub struct {
	delivery events.Delivery
	err      error
	tenant   directoryspec.TenantID
}

func (p *eventPeersStub) Deliver(
	_ context.Context, tenant directoryspec.TenantID,
	_ federationspec.DeliverEventRequest,
) (events.Delivery, error) {
	p.tenant = tenant
	return p.delivery, p.err
}

func eventRelayServer(
	coordinatorURL string, peers meshapi.EventPeers,
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
		EventPeers: peers,
	}
}

func eventRelayCall(
	s *meshapi.Server, body string, credential string,
) *httptest.ResponseRecorder {
	request := httptest.NewRequest(
		http.MethodPost, "/mesh/events/deliver", strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	if credential != "" {
		request.Header.Set("Authorization", "Bearer "+credential)
	}
	recorder := httptest.NewRecorder()
	RelayDeliverEvent(s)(recorder, request)
	return recorder
}

func TestRelayDeliverEventRoutesAndClassifies(t *testing.T) {
	t.Parallel()
	receipt := federationspec.EventReceipt{Outcome: federationspec.EventApplied}
	conflict := federationproblem.EventConflictError
	misdirected := federationproblem.DestinationMisdirectedError
	validation := problem.ValidationFailedError
	validation.Fields = []string{"kind"}
	teapot := problem.Details{Type: "x/other", Status: 418}
	for _, test := range []struct {
		name    string
		did     string
		peers   *eventPeersStub
		status  int
		problem string
	}{
		{
			name: "remote receipt", did: testAuthorityDID,
			peers:  &eventPeersStub{delivery: events.Delivery{Receipt: &receipt}},
			status: 200,
		},
		{
			name: "unknown destination", did: "018f7e32-7b5a-7d31-8fd0-aaaaaaaaaaaa",
			peers: &eventPeersStub{}, status: 404,
			problem: federationproblem.DestinationNotFoundError.Type,
		},
		{
			name: "peer unreachable", did: testAuthorityDID,
			peers:  &eventPeersStub{err: meshwire.ErrNotSent},
			status: 503, problem: federationproblem.EventUndeliveredError.Type,
		},
		{
			name: "peer outcome unknown", did: testAuthorityDID,
			peers:  &eventPeersStub{err: meshwire.ErrOutcomeUnknown},
			status: 503, problem: federationproblem.EventUndeliveredError.Type,
		},
		{
			name: "peer conflict", did: testAuthorityDID,
			peers:  &eventPeersStub{delivery: events.Delivery{Problem: &conflict}},
			status: 409, problem: conflict.Type,
		},
		{
			name: "peer misdirected", did: testAuthorityDID,
			peers: &eventPeersStub{
				delivery: events.Delivery{Problem: &misdirected},
			},
			status: 421, problem: misdirected.Type,
		},
		{
			name: "peer unknown kind", did: testAuthorityDID,
			peers: &eventPeersStub{
				delivery: events.Delivery{Problem: &validation},
			},
			status: 400, problem: validation.Type,
		},
		{
			name: "undeclared peer problem", did: testAuthorityDID,
			peers:  &eventPeersStub{delivery: events.Delivery{Problem: &teapot}},
			status: 503, problem: federationproblem.EventUndeliveredError.Type,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			s := eventRelayServer(fakeCoordinator(t, "usa1").URL, test.peers)
			recorder := eventRelayCall(s, testEventBody(test.did), testCredential)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
			}
			if test.problem != "" && problemType(t, recorder) != test.problem {
				t.Fatalf("problem = %s", recorder.Body)
			}
			if test.status == 200 {
				if test.peers.tenant != "usa1" ||
					recorder.Header().Get("Cache-Control") != "no-store" ||
					strings.TrimSpace(recorder.Body.String()) !=
						`{"outcome":"applied"}` {
					t.Fatalf("routed to %q: %v %q", test.peers.tenant,
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

func TestRelayDeliverEventRefusesBeforeRouting(t *testing.T) {
	t.Parallel()
	peers := &eventPeersStub{}
	s := eventRelayServer(fakeCoordinator(t, "usa1").URL, peers)
	for _, test := range []struct {
		name       string
		body       string
		credential string
		status     int
		problem    string
	}{
		{
			name: "missing credential", body: testEventBody(testAuthorityDID),
			status:  401,
			problem: coordinatorproblem.MeshRelayAuthenticationRequiredError.Type,
		},
		{
			name: "wrong credential", body: testEventBody(testAuthorityDID),
			credential: "wrong", status: 401,
			problem: coordinatorproblem.MeshRelayAuthenticationRequiredError.Type,
		},
		{
			name: "malformed", body: `{`, credential: testCredential,
			status: 400, problem: problem.InvalidJSONError.Type,
		},
		{
			name: "invalid", body: strings.Replace(
				testEventBody(testAuthorityDID), `"aggregate_version":2`,
				`"aggregate_version":0`, 1,
			),
			credential: testCredential, status: 400,
			problem: problem.ValidationFailedError.Type,
		},
	} {
		recorder := eventRelayCall(s, test.body, test.credential)
		if recorder.Code != test.status || problemType(t, recorder) != test.problem {
			t.Errorf("%s: %d %s", test.name, recorder.Code, recorder.Body)
		}
	}
	if peers.tenant != "" {
		t.Fatal("a refused event reached a peer")
	}
}

func TestRelayDeliverEventDirectoryOutageIsUndelivered(t *testing.T) {
	t.Parallel()
	coordinator := fakeCoordinator(t, "usa1")
	coordinator.Close()
	peers := &eventPeersStub{}
	recorder := eventRelayCall(
		eventRelayServer(coordinator.URL, peers),
		testEventBody(testAuthorityDID), testCredential,
	)
	if recorder.Code != 503 || problemType(t, recorder) !=
		federationproblem.EventUndeliveredError.Type || peers.tenant != "" {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body)
	}
}

func TestPeerDeliverEventRequiresTenantIdentity(t *testing.T) {
	t.Parallel()
	s := eventRelayServer("http://127.0.0.1:1", &eventPeersStub{})
	request := httptest.NewRequest(http.MethodPost,
		"/api/mesh/events/deliver",
		strings.NewReader(testEventBody(testAuthorityDID)))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	PeerDeliverEvent(s)(recorder, request)
	if recorder.Code != 401 ||
		recorder.Header().Get("WWW-Authenticate") != `MutualTLS realm="mesh-api"` ||
		problemType(t, recorder) !=
			coordinatorproblem.MeshPeerAuthenticationRequiredError.Type {
		t.Fatalf("status = %d, headers = %v, body = %s",
			recorder.Code, recorder.Header(), recorder.Body)
	}
}
