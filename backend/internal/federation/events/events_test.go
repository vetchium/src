package events

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/dbvalue"
	"backend/internal/federation/meshwire"
)

func testDestination(t *testing.T) Principal {
	t.Helper()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return Principal{Type: directoryspec.PrincipalHubUser, DID: did}
}

func TestEnqueueRejectsInvalidEventsBeforeWriting(t *testing.T) {
	t.Parallel()
	valid := Outgoing{
		Kind: "test-event", Destination: testDestination(t),
		AggregateType: "test_aggregate", AggregateID: "aggregate",
		AggregateVersion: 1, Payload: map[string]int{"value": 1},
	}
	for name, change := range map[string]func(*Outgoing){
		"kind":           func(o *Outgoing) { o.Kind = "Bad_Kind" },
		"destination":    func(o *Outgoing) { o.Destination.Type = "admin" },
		"aggregate type": func(o *Outgoing) { o.AggregateType = "Bad-Type" },
		"aggregate id":   func(o *Outgoing) { o.AggregateID = " " },
		"version":        func(o *Outgoing) { o.AggregateVersion = 0 },
		"array payload":  func(o *Outgoing) { o.Payload = []int{1} },
		"unencodable":    func(o *Outgoing) { o.Payload = func() {} },
	} {
		event := valid
		change(&event)
		// A nil transaction proves nothing was written.
		if _, err := Enqueue(context.Background(), nil, event); err == nil {
			t.Errorf("%s: invalid event enqueued", name)
		}
	}
}

func TestRegistryRefusesInvalidAndDuplicateKinds(t *testing.T) {
	t.Parallel()
	handler := func(context.Context, pgx.Tx, Event) error { return nil }
	registry := NewRegistry()
	registry.Register("test-event", handler)
	for name, register := range map[string]func(){
		"duplicate":   func() { registry.Register("test-event", handler) },
		"invalid":     func() { registry.Register("Test_Event", handler) },
		"nil handler": func() { registry.Register("test-other", nil) },
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s registration did not panic", name)
				}
			}()
			register()
		}()
	}
	if _, ok := registry.handler("test-event"); !ok {
		t.Fatal("registered kind missing")
	}
	if _, ok := (*Registry)(nil).handler("test-event"); ok {
		t.Fatal("nil registry found a handler")
	}
}

func TestDigestCoversEveryFieldButNotEncoding(t *testing.T) {
	t.Parallel()
	event := Event{
		Kind: "test-event", Destination: testDestination(t),
		AggregateType: "test_aggregate", AggregateID: "aggregate",
		AggregateVersion: 2, Payload: json.RawMessage(`{"b":1,"a":"x"}`),
	}
	base, err := digest(event)
	if err != nil {
		t.Fatal(err)
	}
	reencoded := event
	reencoded.Payload = json.RawMessage(` { "a" : "x", "b" : 1 } `)
	if same, err := digest(reencoded); err != nil || string(same) != string(base) {
		t.Fatalf("re-encoded payload changed the digest: %v", err)
	}
	for name, change := range map[string]func(*Event){
		"kind":           func(e *Event) { e.Kind = "test-other" },
		"destination":    func(e *Event) { e.Destination = testDestination(t) },
		"aggregate type": func(e *Event) { e.AggregateType = "test_other" },
		"aggregate id":   func(e *Event) { e.AggregateID = "other" },
		"version":        func(e *Event) { e.AggregateVersion = 3 },
		"payload":        func(e *Event) { e.Payload = json.RawMessage(`{"a":"y","b":1}`) },
	} {
		changed := event
		change(&changed)
		if other, err := digest(changed); err != nil || string(other) == string(base) {
			t.Errorf("%s change kept the digest: %v", name, err)
		}
	}
}

func TestWireRequestRoundTrips(t *testing.T) {
	t.Parallel()
	eventID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	event := Event{
		EventID: eventID, Kind: "test-event", Destination: testDestination(t),
		AggregateType: "test_aggregate", AggregateID: "aggregate",
		AggregateVersion: 7, Payload: json.RawMessage(`{"a":1}`),
	}
	request := wireRequest(event)
	if fields := request.Validate(); len(fields) != 0 {
		t.Fatalf("wire request invalid: %v", fields)
	}
	back, err := FromWire(request, "usa1")
	if err != nil || back.EventID != event.EventID ||
		back.Destination != event.Destination || back.SourceTenantID != "usa1" ||
		back.AggregateVersion != 7 || string(back.Payload) != `{"a":1}` {
		t.Fatalf("round trip = %+v, %v", back, err)
	}
}

func testRequest() federationspec.DeliverEventRequest {
	return federationspec.DeliverEventRequest{
		EventID: "f4847331-5a4f-4eae-a5f4-cc131b0cd270", Kind: "test-event",
		DestinationPrincipalType: directoryspec.PrincipalOrg,
		DestinationPrincipalDID:  "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		AggregateType:            "test_aggregate", AggregateID: "aggregate",
		AggregateVersion: 1, Payload: json.RawMessage(`{"value":1}`),
	}
}

func writeProblem(w http.ResponseWriter, details problem.Details) {
	w.Header().Set("Content-Type", problem.MediaType)
	w.WriteHeader(details.Status)
	_ = json.NewEncoder(w).Encode(details)
}

func writeJSON(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, body)
}

func TestRelayClientClassifiesAnswers(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		respond func(http.ResponseWriter)
		check   func(Delivery, error) bool
	}{
		{"receipt", func(w http.ResponseWriter) {
			writeJSON(w, `{"outcome":"superseded"}`)
		}, func(d Delivery, err error) bool {
			return err == nil && d.Receipt != nil &&
				d.Receipt.Outcome == federationspec.EventSuperseded
		}},
		{"conflict is definite", func(w http.ResponseWriter) {
			writeProblem(w, federationproblem.EventConflictError)
		}, func(d Delivery, err error) bool {
			return err == nil && d.Problem != nil && d.Problem.Status == 409
		}},
		{"unknown destination is definite", func(w http.ResponseWriter) {
			writeProblem(w, federationproblem.DestinationNotFoundError)
		}, func(d Delivery, err error) bool {
			return err == nil && d.Problem != nil && d.Problem.Status == 404
		}},
		{"undelivered retries", func(w http.ResponseWriter) {
			writeProblem(w, federationproblem.EventUndeliveredError)
		}, func(_ Delivery, err error) bool { return err != nil }},
		{"misdirected retries", func(w http.ResponseWriter) {
			writeProblem(w, federationproblem.DestinationMisdirectedError)
		}, func(_ Delivery, err error) bool { return err != nil }},
		{"unknown kind retries", func(w http.ResponseWriter) {
			writeProblem(w, problem.ValidationFailedError)
		}, func(_ Delivery, err error) bool { return err != nil }},
		{"rejected credential retries", func(w http.ResponseWriter) {
			writeProblem(w,
				coordinatorproblem.MeshRelayAuthenticationRequiredError)
		}, func(_ Delivery, err error) bool { return err != nil }},
		{"unknown outcome retries", func(w http.ResponseWriter) {
			writeJSON(w, `{"outcome":"delivered"}`)
		}, func(_ Delivery, err error) bool { return err != nil }},
		{"extra receipt field retries", func(w http.ResponseWriter) {
			writeJSON(w, `{"outcome":"applied","extra":1}`)
		}, func(_ Delivery, err error) bool { return err != nil }},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(
				func(w http.ResponseWriter, r *http.Request) {
					var request federationspec.DeliverEventRequest
					if r.URL.Path != "/mesh/events/deliver" ||
						r.Header.Get("Authorization") != "Bearer secret" ||
						json.NewDecoder(r.Body).Decode(&request) != nil ||
						request.EventID != testRequest().EventID {
						t.Errorf("request = %s %q", r.URL.Path,
							r.Header.Get("Authorization"))
					}
					test.respond(w)
				},
			))
			defer server.Close()
			client := NewRelay(server.URL+"/", "secret", time.Second)
			delivery, err := client.Deliver(context.Background(), testRequest())
			if !test.check(delivery, err) {
				t.Fatalf("delivery = %+v, err = %v", delivery, err)
			}
		})
	}
}

func TestRelayClientConnectionFailureRetries(t *testing.T) {
	t.Parallel()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	client := NewRelay("http://"+address, "secret", time.Second)
	if _, err := client.Deliver(
		context.Background(), testRequest(),
	); !errors.Is(err, meshwire.ErrNotSent) {
		t.Fatalf("err = %v, want not sent", err)
	}
}

func TestPeerClientPassesClientProblems(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		respond func(http.ResponseWriter)
		check   func(Delivery, error) bool
	}{
		{"receipt", func(w http.ResponseWriter) {
			writeJSON(w, `{"outcome":"applied"}`)
		}, func(d Delivery, err error) bool {
			return err == nil && d.Receipt != nil
		}},
		{"misdirected", func(w http.ResponseWriter) {
			writeProblem(w, federationproblem.DestinationMisdirectedError)
		}, func(d Delivery, err error) bool {
			return err == nil && d.Problem != nil && d.Problem.Status == 421
		}},
		{"server error", func(w http.ResponseWriter) {
			writeProblem(w, problem.InternalServerError)
		}, func(_ Delivery, err error) bool {
			return errors.Is(err, meshwire.ErrOutcomeUnknown)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(
				func(w http.ResponseWriter, r *http.Request) {
					if r.Header.Get("Authorization") != "" {
						t.Error("peer request carried a relay credential")
					}
					test.respond(w)
				},
			))
			defer server.Close()
			client := &PeerClient{
				baseTLS: &tls.Config{MinVersion: tls.VersionTLS12},
				timeout: time.Second,
				endpoint: func(directoryspec.TenantID) string {
					return server.URL
				},
			}
			delivery, err := client.Deliver(
				context.Background(), "usa1", testRequest(),
			)
			if !test.check(delivery, err) {
				t.Fatalf("delivery = %+v, err = %v", delivery, err)
			}
		})
	}
}

func TestPeerClientRejectsAnInvalidTenantBeforeSending(t *testing.T) {
	t.Parallel()
	client := NewPeer(&tls.Config{MinVersion: tls.VersionTLS12}, time.Second)
	if _, err := client.Deliver(
		context.Background(), "US", testRequest(),
	); !errors.Is(err, meshwire.ErrNotSent) {
		t.Fatalf("err = %v, want not sent", err)
	}
}
