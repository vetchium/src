package apiserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	problemspec "github.com/vetchium/src/typespec/problem"
)

func TestInternalError(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewJSONHandler(&logs, nil)))
	recorder := httptest.NewRecorder()
	runtime.InternalError(
		context.Background(), recorder, "load test resource",
		errors.New("database unavailable"),
	)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != problemspec.MediaType {
		t.Fatalf("Content-Type = %q, want %q", got, problemspec.MediaType)
	}
	var details problemspec.Details
	if err := json.NewDecoder(recorder.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	assertDetailsEqual(t, details, problemspec.InternalServerError)
	if len(details.Fields) != 0 {
		t.Fatalf("fields = %v, want none", details.Fields)
	}
	wantedLogs := []string{
		`"level":"ERROR"`,
		`"event":"request_error"`,
		`"operation":"load test resource"`,
		`"error":"database unavailable"`,
	}
	for _, want := range wantedLogs {
		if !bytes.Contains(logs.Bytes(), []byte(want)) {
			t.Errorf("log = %q, want %q", logs.String(), want)
		}
	}
}

func TestInternalErrorLogsEncodingFailure(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logs, nil)))
	writer := errorResponseWriter{header: make(http.Header)}
	runtime.InternalError(
		context.Background(), writer, "test operation",
		errors.New("original error"),
	)
	if !bytes.Contains(logs.Bytes(), []byte("encode problem response")) {
		t.Fatalf("log = %q", logs.String())
	}
}

// Every handler exit has to leave a traceable line, so the two shared
// responders record the reply even when nothing else logs.
func TestEveryResponseIsRecorded(t *testing.T) {
	for _, test := range []struct {
		name     string
		respond  func(*Runtime, http.ResponseWriter)
		wantLogs []string
	}{
		{
			name: "client problem",
			respond: func(runtime *Runtime, w http.ResponseWriter) {
				runtime.Problem(
					context.Background(), w, problemspec.InvalidJSONError,
				)
			},
			wantLogs: []string{
				`"level":"INFO"`,
				`"event":"problem_response"`,
				`"problem_type":"` + problemspec.InvalidJSONError.Type + `"`,
				`"status":400`,
			},
		},
		{
			name: "validation problem carries the failing fields",
			respond: func(runtime *Runtime, w http.ResponseWriter) {
				runtime.ValidationFailed(
					context.Background(), w, []string{"email_address"},
				)
			},
			wantLogs: []string{
				`"event":"problem_response"`,
				`"fields":["email_address"]`,
			},
		},
		{
			name: "server problem stays above info",
			respond: func(runtime *Runtime, w http.ResponseWriter) {
				runtime.Problem(
					context.Background(), w, problemspec.InternalServerError,
				)
			},
			wantLogs: []string{`"level":"WARN"`, `"status":500`},
		},
		{
			name: "JSON response",
			respond: func(runtime *Runtime, w http.ResponseWriter) {
				runtime.JSON(
					context.Background(), w, http.StatusOK,
					map[string]string{"value": "ok"},
				)
			},
			wantLogs: []string{
				`"level":"INFO"`, `"event":"json_response"`, `"status":200`,
			},
		},
		{
			name: "bodyless response",
			respond: func(runtime *Runtime, w http.ResponseWriter) {
				runtime.Empty(
					context.Background(), w, http.StatusNoContent,
				)
			},
			wantLogs: []string{
				`"level":"INFO"`, `"event":"empty_response"`, `"status":204`,
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var logs bytes.Buffer
			runtime := New(nil, slog.New(slog.NewJSONHandler(&logs, nil)))

			test.respond(runtime, httptest.NewRecorder())

			for _, want := range test.wantLogs {
				if !bytes.Contains(logs.Bytes(), []byte(want)) {
					t.Errorf("log = %q, want %q", logs.String(), want)
				}
			}
		})
	}
}

// RFC 9110 section 11.6.1 requires every 401 to name a challenge, and the
// TypeSpec contract declares the header, so the responder has to emit it.
func TestAuthenticationProblemCarriesTheChallenge(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewJSONHandler(&logs, nil)))
	recorder := httptest.NewRecorder()

	runtime.AuthenticationProblem(
		context.Background(), recorder, unauthenticated,
		`Bearer realm="test"`,
	)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
	got := recorder.Header().Get("WWW-Authenticate")
	if got != `Bearer realm="test"` {
		t.Fatalf("WWW-Authenticate = %q", got)
	}
	var details problemspec.Details
	if err := json.NewDecoder(recorder.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	assertDetailsEqual(t, details, unauthenticated)
	if bytes.Contains(logs.Bytes(), []byte("missing_authentication_challenge")) {
		t.Fatalf("log = %q, want no missing-challenge report", logs.String())
	}
}

// The split into two responders cannot stop a 401 from reaching the
// challengeless one, so the omission has to be visible in the logs rather than
// silently shipped to the client.
func TestUnauthorizedWithoutAChallengeIsReported(t *testing.T) {
	for _, test := range []struct {
		name    string
		respond func(*Runtime, http.ResponseWriter)
	}{
		{
			name: "plain problem responder",
			respond: func(runtime *Runtime, w http.ResponseWriter) {
				runtime.Problem(context.Background(), w, unauthenticated)
			},
		},
		{
			name: "empty challenge",
			respond: func(runtime *Runtime, w http.ResponseWriter) {
				runtime.AuthenticationProblem(
					context.Background(), w, unauthenticated, "",
				)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var logs bytes.Buffer
			runtime := New(nil, slog.New(slog.NewJSONHandler(&logs, nil)))
			recorder := httptest.NewRecorder()

			test.respond(runtime, recorder)

			wantedLogs := []string{
				`"level":"ERROR"`,
				`"event":"missing_authentication_challenge"`,
				`"problem_type":"` + unauthenticated.Type + `"`,
			}
			for _, want := range wantedLogs {
				if !bytes.Contains(logs.Bytes(), []byte(want)) {
					t.Errorf("log = %q, want %q", logs.String(), want)
				}
			}
			// The reply still goes out, so a contract mistake cannot turn
			// into a request that never completes.
			if recorder.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", recorder.Code)
			}
			if got := recorder.Header().Get("WWW-Authenticate"); got != "" {
				t.Errorf("WWW-Authenticate = %q, want none", got)
			}
		})
	}
}

// Only a 401 names a challenge, so no other rejection may carry the header.
func TestProblemSetsNoChallengeHeader(t *testing.T) {
	runtime := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	recorder := httptest.NewRecorder()

	runtime.Problem(
		context.Background(), recorder, problemspec.InvalidJSONError,
	)

	if got := recorder.Header().Get("WWW-Authenticate"); got != "" {
		t.Fatalf("WWW-Authenticate = %q, want none", got)
	}
}

// A successful response must never carry the encoded body into the log, since
// session tokens and recovery codes travel in it.
func TestJSONDoesNotLogTheEncodedValue(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewJSONHandler(&logs, nil)))

	runtime.JSON(
		context.Background(), httptest.NewRecorder(), http.StatusOK,
		map[string]string{"session_token": "super-secret-token"},
	)

	if bytes.Contains(logs.Bytes(), []byte("super-secret-token")) {
		t.Fatalf("log leaked the response body: %s", logs.String())
	}
}

func TestInvalidJSON(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewJSONHandler(&logs, nil)))
	recorder := httptest.NewRecorder()
	runtime.InvalidJSON(
		context.Background(), recorder, errors.New("unexpected EOF"),
	)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != problemspec.MediaType {
		t.Fatalf("Content-Type = %q, want %q", got, problemspec.MediaType)
	}
	var details problemspec.Details
	if err := json.NewDecoder(recorder.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	assertDetailsEqual(t, details, problemspec.InvalidJSONError)
	wantedLogs := []string{
		`"level":"WARN"`,
		`"event":"invalid_json"`,
		`"error":"unexpected EOF"`,
	}
	for _, want := range wantedLogs {
		if !bytes.Contains(logs.Bytes(), []byte(want)) {
			t.Errorf("log = %q, want %q", logs.String(), want)
		}
	}
}

func TestInvalidJSONLogsEncodingFailure(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logs, nil)))
	writer := errorResponseWriter{header: make(http.Header)}
	runtime.InvalidJSON(
		context.Background(), writer, errors.New("unexpected EOF"),
	)
	if !bytes.Contains(logs.Bytes(), []byte("encode problem response")) {
		t.Fatalf("log = %q", logs.String())
	}
}

func TestValidationFailed(t *testing.T) {
	runtime := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	recorder := httptest.NewRecorder()
	runtime.ValidationFailed(
		context.Background(), recorder,
		[]string{"email_address", "password"},
	)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != problemspec.MediaType {
		t.Fatalf("Content-Type = %q, want %q", got, problemspec.MediaType)
	}
	var details problemspec.Details
	if err := json.NewDecoder(recorder.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	expected := problemspec.ValidationFailedError
	expected.Fields = []string{"email_address", "password"}
	assertDetailsEqual(t, details, expected)
	if len(details.Fields) != 2 ||
		details.Fields[0] != "email_address" ||
		details.Fields[1] != "password" {
		t.Fatalf("fields = %v", details.Fields)
	}
}

func TestValidationFailedLogsEncodingFailure(t *testing.T) {
	var logs bytes.Buffer
	runtime := New(nil, slog.New(slog.NewTextHandler(&logs, nil)))
	writer := errorResponseWriter{header: make(http.Header)}
	runtime.ValidationFailed(
		context.Background(), writer, []string{"email_address"},
	)
	if !bytes.Contains(logs.Bytes(), []byte("encode problem response")) {
		t.Fatalf("log = %q", logs.String())
	}
}

// unauthenticated stands in for a portal's 401, which the portal problem
// packages declare rather than the shared one.
var unauthenticated = problemspec.Details{
	Type:   "vetchium-problem-details/test-authentication-required",
	Title:  "Authentication required",
	Status: http.StatusUnauthorized,
	Detail: "The request carried no live session",
}

func assertDetailsEqual(t *testing.T, got, want problemspec.Details) {
	t.Helper()
	if got.Type != want.Type || got.Title != want.Title ||
		got.Status != want.Status || got.Detail != want.Detail ||
		got.Instance != want.Instance {
		t.Fatalf("problem = %+v, want %+v", got, want)
	}
}

type errorResponseWriter struct {
	header http.Header
}

func (w errorResponseWriter) Header() http.Header { return w.header }
func (errorResponseWriter) WriteHeader(int)       {}
func (errorResponseWriter) Write([]byte) (int, error) {
	return 0, io.ErrClosedPipe
}
