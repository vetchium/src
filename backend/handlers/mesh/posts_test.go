package mesh

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	postsspec "github.com/vetchium/src/typespec/hub/posts"

	"backend/internal/directoryclient"
	"backend/internal/meshapi"
)

func postsServer(t *testing.T) *meshapi.Server {
	t.Helper()
	coordinator := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(coordinator.Close)
	return &meshapi.Server{
		Runtime:    relayServer(coordinator.URL, nil).Runtime,
		TenantID:   "sgp",
		Credential: testCredential,
		Directory: directoryclient.New(
			coordinator.URL, "/directory", "", time.Second),
	}
}

func listBody(t *testing.T) string {
	t.Helper()
	body, err := json.Marshal(postsspec.MeshListPostsRequest{
		OwnerHubUserDID: blockBlocker, ViewerHubUserDID: blockViewer,
		ViewerHandle: viewerHandle,
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func TestRelayPostsRejectCredentialAndInvalidBody(t *testing.T) {
	s := postsServer(t)
	for _, test := range []struct {
		name, auth, body string
		want             int
	}{
		{"no credential", "", listBody(t), http.StatusUnauthorized},
		{"wrong credential", "Bearer wrong", listBody(t), http.StatusUnauthorized},
		{"invalid field", "Bearer " + testCredential,
			`{"owner_hub_user_did":"x","viewer_hub_user_did":"y","viewer_handle":"z"}`,
			http.StatusBadRequest},
	} {
		for name, handler := range map[string]http.HandlerFunc{
			"list": RelayListPosts(s), "get-many": RelayGetManyPosts(s),
		} {
			request := httptest.NewRequest(
				http.MethodPost, "/mesh/posts/"+name, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			if test.auth != "" {
				request.Header.Set("Authorization", test.auth)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Errorf("%s %s: status %d: %s",
					name, test.name, response.Code, response.Body)
			}
		}
	}
}

// A peer call without a verified tenant certificate never reads a post.
func TestPeerPostsRefuseUnidentifiedCaller(t *testing.T) {
	s := postsServer(t)
	request := httptest.NewRequest(
		http.MethodPost, "/api/mesh/posts/list", strings.NewReader(listBody(t)))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	PeerListPosts(s).ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Errorf("status %d: %s", response.Code, response.Body)
	}
}
