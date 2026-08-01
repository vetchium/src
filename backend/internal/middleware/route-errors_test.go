package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/httpx"
)

func TestProblemRouteErrors(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /known", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := ProblemRouteErrors(mux)

	tests := []struct {
		name   string
		method string
		path   string
		status int
	}{
		{name: "not found", method: http.MethodGet, path: "/missing", status: http.StatusNotFound},
		{name: "method not allowed", method: http.MethodPost, path: "/known", status: http.StatusMethodNotAllowed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil))
			if recorder.Code != test.status {
				t.Fatalf("status = %d, want %d", recorder.Code, test.status)
			}
			if got := recorder.Header().Get("Content-Type"); got != "application/problem+json" {
				t.Fatalf("Content-Type = %q", got)
			}
			if test.status == http.StatusMethodNotAllowed && recorder.Header().Get("Allow") == "" {
				t.Fatal("405 response is missing Allow header")
			}
			var problem httpx.Problem
			if err := json.NewDecoder(recorder.Body).Decode(&problem); err != nil {
				t.Fatal(err)
			}
			if problem.Status != test.status || problem.Title != http.StatusText(test.status) {
				t.Fatalf("problem = %+v", problem)
			}
		})
	}
}

func TestProblemRouteErrorsPreservesServeMuxDispatch(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(r.PathValue("id") + "|" + r.Pattern))
	})
	handler := ProblemRouteErrors(mux)

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/users/42", nil))
	if got := recorder.Body.String(); got != "42|GET /users/{id}" {
		t.Fatalf("wildcard dispatch = %q", got)
	}

	mux.HandleFunc("GET /clean", func(http.ResponseWriter, *http.Request) {})
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/clean//", nil))
	if recorder.Code < 300 || recorder.Code >= 400 || recorder.Header().Get("Location") == "" {
		t.Fatalf("clean-path redirect = %d, Location %q", recorder.Code, recorder.Header().Get("Location"))
	}
}

func TestProblemRouteErrorsHandlesAsteriskRequest(t *testing.T) {
	handler := ProblemRouteErrors(http.NewServeMux())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodOptions, "*", nil))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := recorder.Header().Get("Connection"); got != "close" {
		t.Fatalf("Connection = %q, want close", got)
	}
}
