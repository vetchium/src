package handlerauth

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
)

type runtimeServerStub struct {
	runtime *apiserver.Runtime
}

func (s runtimeServerStub) HandlerRuntime() *apiserver.Runtime {
	return s.runtime
}

func TestDecodeAndValidate(t *testing.T) {
	server := runtimeServerStub{runtime: apiserver.New(
		nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
	)}
	for _, test := range []struct {
		name       string
		body       string
		validate   func(string) []string
		wantOK     bool
		wantStatus int
	}{
		{
			name: "valid", body: `{"value":"ok"}`,
			validate: func(string) []string { return nil },
			wantOK:   true, wantStatus: http.StatusOK,
		},
		{
			name: "invalid JSON", body: `{"unknown":true}`,
			validate:   func(string) []string { return nil },
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "invalid wire value", body: `{"value":"bad"}`,
			validate: func(value string) []string {
				if value == "bad" {
					return []string{"value"}
				}
				return nil
			},
			wantStatus: http.StatusBadRequest,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var request struct {
				Value string `json:"value"`
			}
			httpRequest := httptest.NewRequest(
				http.MethodPost, "/", bytes.NewBufferString(test.body),
			)
			httpRequest.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			got := DecodeAndValidate(
				server, response, httpRequest, &request,
				func() []string { return test.validate(request.Value) },
			)
			if got != test.wantOK || response.Code != test.wantStatus {
				t.Fatalf(
					"result = %t, status = %d; want %t, %d",
					got, response.Code, test.wantOK, test.wantStatus,
				)
			}
		})
	}
}

func TestFailure(t *testing.T) {
	_, got, err := Failure[struct{}](
		problem.InvalidJSONError, `Bearer realm="test"`,
	)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Details.Type != problem.InvalidJSONError.Type ||
		got.WWWAuthenticate != `Bearer realm="test"` {
		encoded, _ := json.Marshal(got)
		t.Fatalf("problem = %s", encoded)
	}
}
