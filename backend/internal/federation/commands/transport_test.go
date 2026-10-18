package commands

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

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
)

func testWireRequest() federationspec.ExecuteCommandRequest {
	return federationspec.ExecuteCommandRequest{
		CommandID:              "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
		CorrelationID:          "0d3b2a35-5f1c-4f5e-9d47-0a5b7f2e9c11",
		Kind:                   "test-command",
		AuthorityPrincipalType: directoryspec.PrincipalOrg,
		AuthorityPrincipalDID:  "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		AggregateID:            "aggregate",
		Payload:                json.RawMessage(`{"value":1}`),
	}
}

func writeProblem(w http.ResponseWriter, details problem.Details) {
	w.Header().Set("Content-Type", problem.MediaType)
	w.WriteHeader(details.Status)
	_ = json.NewEncoder(w).Encode(details)
}

func writeResult(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, body)
}

func TestRelayClientClassifiesOutcomes(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		respond func(http.ResponseWriter)
		status  int
		err     error
	}{
		{
			name: "executed success",
			respond: func(w http.ResponseWriter) {
				writeResult(w, `{"status":201,"body":{"id":"x"}}`)
			},
			status: 201,
		},
		{
			name: "executed rejection",
			respond: func(w http.ResponseWriter) {
				writeResult(w, `{"status":409,"body":{"type":"t","status":409}}`)
			},
			status: 409,
		},
		{
			name: "authority not found is deterministic",
			respond: func(w http.ResponseWriter) {
				writeProblem(w, federationproblem.AuthorityNotFoundError)
			},
			status: 404,
		},
		{
			name: "authority unavailable was not sent",
			respond: func(w http.ResponseWriter) {
				writeProblem(w, federationproblem.AuthorityUnavailableError)
			},
			err: ErrNotSent,
		},
		{
			name: "rejected relay credential was not sent",
			respond: func(w http.ResponseWriter) {
				writeProblem(w,
					coordinatorproblem.MeshRelayAuthenticationRequiredError)
			},
			err: ErrNotSent,
		},
		{
			name: "outcome unknown at the relay",
			respond: func(w http.ResponseWriter) {
				writeProblem(w, federationproblem.CommandOutcomeUnknownError)
			},
			err: ErrOutcomeUnknown,
		},
		{
			name: "protocol conflict stays unknown",
			respond: func(w http.ResponseWriter) {
				writeProblem(w, federationproblem.CommandConflictError)
			},
			err: ErrOutcomeUnknown,
		},
		{
			name: "server error stays unknown",
			respond: func(w http.ResponseWriter) {
				writeProblem(w, problem.InternalServerError)
			},
			err: ErrOutcomeUnknown,
		},
		{
			name: "result outside the stored range stays unknown",
			respond: func(w http.ResponseWriter) {
				writeResult(w, `{"status":503,"body":{}}`)
			},
			err: ErrOutcomeUnknown,
		},
		{
			name: "unknown result field stays unknown",
			respond: func(w http.ResponseWriter) {
				writeResult(w, `{"status":200,"body":{},"extra":1}`)
			},
			err: ErrOutcomeUnknown,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(
				func(w http.ResponseWriter, r *http.Request) {
					var request federationspec.ExecuteCommandRequest
					if r.URL.Path != "/mesh/commands/execute" ||
						r.Header.Get("Authorization") != "Bearer secret" ||
						json.NewDecoder(r.Body).Decode(&request) != nil ||
						request.CommandID != testWireRequest().CommandID {
						t.Errorf("request = %s %q", r.URL.Path,
							r.Header.Get("Authorization"))
					}
					test.respond(w)
				},
			))
			defer server.Close()
			client := NewRelay(server.URL+"/", "secret", time.Second)
			response, err := client.Execute(context.Background(), testWireRequest())
			if test.err != nil {
				if !errors.Is(err, test.err) {
					t.Fatalf("err = %v, want %v", err, test.err)
				}
				return
			}
			if err != nil || response.Status != test.status ||
				!json.Valid(response.Body) {
				t.Fatalf("response = %+v, err = %v", response, err)
			}
		})
	}
}

func TestRelayClientConnectionFailureWasNotSent(t *testing.T) {
	t.Parallel()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	client := NewRelay("http://"+address, "secret", time.Second)
	if _, err := client.Execute(
		context.Background(), testWireRequest(),
	); !errors.Is(err, ErrNotSent) {
		t.Fatalf("err = %v, want ErrNotSent", err)
	}
}

func TestRelayClientLostResponseIsUnknown(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(
		func(_ http.ResponseWriter, r *http.Request) {
			_, _ = io.ReadAll(r.Body)
			<-release
		},
	))
	defer server.Close()
	defer close(release)
	client := NewRelay(server.URL, "secret", 100*time.Millisecond)
	if _, err := client.Execute(
		context.Background(), testWireRequest(),
	); !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatalf("err = %v, want ErrOutcomeUnknown", err)
	}
}

func TestPeerClientPassesOnlyNonExecutionProblems(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		respond func(http.ResponseWriter)
		check   func(PeerOutcome, error) bool
	}{
		{
			name: "result",
			respond: func(w http.ResponseWriter) {
				writeResult(w, `{"status":200,"body":{"ok":true}}`)
			},
			check: func(outcome PeerOutcome, err error) bool {
				return err == nil && outcome.Result != nil &&
					outcome.Result.Status == 200
			},
		},
		{
			name: "misdirected",
			respond: func(w http.ResponseWriter) {
				writeProblem(w, federationproblem.AuthorityMisdirectedError)
			},
			check: func(outcome PeerOutcome, err error) bool {
				return err == nil && outcome.Problem != nil &&
					outcome.Problem.Status == 421
			},
		},
		{
			name: "server error",
			respond: func(w http.ResponseWriter) {
				writeProblem(w, problem.InternalServerError)
			},
			check: func(_ PeerOutcome, err error) bool {
				return errors.Is(err, ErrOutcomeUnknown)
			},
		},
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
			outcome, err := client.Execute(
				context.Background(), "usa1", testWireRequest(),
			)
			if !test.check(outcome, err) {
				t.Fatalf("outcome = %+v, err = %v", outcome, err)
			}
		})
	}
}

func TestPeerClientRejectsAnInvalidTenantBeforeSending(t *testing.T) {
	t.Parallel()
	client := NewPeer(&tls.Config{MinVersion: tls.VersionTLS12}, time.Second)
	if _, err := client.Execute(
		context.Background(), "US", testWireRequest(),
	); !errors.Is(err, ErrNotSent) {
		t.Fatalf("err = %v, want ErrNotSent", err)
	}
}
