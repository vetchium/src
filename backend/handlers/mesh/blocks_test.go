package mesh

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	blocksspec "github.com/vetchium/src/typespec/hub/blocks"

	"backend/internal/directoryclient"
	"backend/internal/meshapi"
)

const (
	blockBlocker = "01987aef-1234-7abc-8abc-123456789abc"
	blockViewer  = "01987aef-1234-7abc-8abc-123456789abd"
	viewerHandle = "abcde000-123456789ab"
)

func TestBlockViewerMustBeHomedByCertificateTenant(t *testing.T) {
	request := blocksspec.CheckBlockRequest{
		BlockerHubUserDID: blockBlocker, BlockedHubUserDID: blockViewer,
		ViewerHandle: viewerHandle,
	}
	resolved := directoryspec.ResolveProfileSlugResponse{
		HubUserDID: blockViewer, Slug: viewerHandle,
		Kind: directoryspec.ProfileSlugKindHandle, HomeTenantID: "sgp",
	}
	if !blockViewerBelongsToCaller(resolved, request, "sgp") {
		t.Fatal("the viewer's home tenant was refused")
	}
	for name, change := range map[string]func(
		*directoryspec.ResolveProfileSlugResponse, *blocksspec.CheckBlockRequest,
		*directoryspec.TenantID,
	){
		"other tenant": func(_ *directoryspec.ResolveProfileSlugResponse,
			_ *blocksspec.CheckBlockRequest, caller *directoryspec.TenantID) {
			*caller = "usa1"
		},
		"other user": func(r *directoryspec.ResolveProfileSlugResponse,
			_ *blocksspec.CheckBlockRequest, _ *directoryspec.TenantID) {
			r.HubUserDID = blockBlocker
		},
		"alias": func(r *directoryspec.ResolveProfileSlugResponse,
			_ *blocksspec.CheckBlockRequest, _ *directoryspec.TenantID) {
			r.Kind = directoryspec.ProfileSlugKindAlias
		},
	} {
		r, q, caller := resolved, request, directoryspec.TenantID("sgp")
		change(&r, &q, &caller)
		if blockViewerBelongsToCaller(r, q, caller) {
			t.Errorf("%s: the viewer verification passed", name)
		}
	}
}

func TestRelayBlockCheckRejectsCredentialAndInvalidBody(t *testing.T) {
	coordinator := httptest.NewServer(http.NotFoundHandler())
	defer coordinator.Close()
	s := &meshapi.Server{
		Runtime:    relayServer(coordinator.URL, nil).Runtime,
		TenantID:   "sgp",
		Credential: testCredential,
		Directory: directoryclient.New(
			coordinator.URL, "/directory", "", time.Second),
	}
	body, _ := json.Marshal(blocksspec.CheckBlockRequest{
		BlockerHubUserDID: blockBlocker, BlockedHubUserDID: blockViewer,
		ViewerHandle: viewerHandle,
	})
	for _, test := range []struct {
		name, auth, body string
		want             int
	}{
		{"no credential", "", string(body), http.StatusUnauthorized},
		{"wrong credential", "Bearer wrong", string(body), http.StatusUnauthorized},
		{"invalid field", "Bearer " + testCredential,
			`{"blocker_hub_user_did":"x","blocked_hub_user_did":"y","viewer_handle":"z"}`,
			http.StatusBadRequest},
	} {
		request := httptest.NewRequest(
			http.MethodPost, "/mesh/blocks/check", strings.NewReader(test.body))
		request.Header.Set("Content-Type", "application/json")
		if test.auth != "" {
			request.Header.Set("Authorization", test.auth)
		}
		response := httptest.NewRecorder()
		RelayCheckBlock(s).ServeHTTP(response, request)
		if response.Code != test.want {
			t.Errorf("%s: status %d: %s", test.name, response.Code, response.Body)
		}
	}
}
