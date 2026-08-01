package routes

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/server"
	"backend/internal/version"
)

func TestMCPRouteReportsBuildVersion(t *testing.T) {
	const buildVersion = "v2.3.4"
	previousVersion := version.Value
	version.Value = buildVersion
	t.Cleanup(func() { version.Value = previousVersion })

	mux := http.NewServeMux()
	RegisterMCPRoutes(mux, &server.Server{
		TenantID: "test",
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	request := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{
		"jsonrpc":"2.0",
		"id":1,
		"method":"initialize",
		"params":{
			"protocolVersion":"2025-11-25",
			"capabilities":{},
			"clientInfo":{"name":"test-client","version":"1.0.0"}
		}
	}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("initialize status = %d, want %d; body: %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload struct {
		Result struct {
			ServerInfo struct {
				Version string `json:"version"`
			} `json:"serverInfo"`
		} `json:"result"`
	}
	body := response.Body.String()
	dataIndex := strings.Index(body, "data: ")
	if dataIndex == -1 {
		t.Fatalf("initialize response has no SSE data event: %s", body)
	}
	data := strings.TrimSpace(body[dataIndex+len("data: "):])
	if err := json.Unmarshal([]byte(data), &payload); err != nil {
		t.Fatalf("decode initialize response: %v; body: %s", err, response.Body.String())
	}
	if payload.Result.ServerInfo.Version != buildVersion {
		t.Fatalf("server version = %q, want %q", payload.Result.ServerInfo.Version, buildVersion)
	}
}
