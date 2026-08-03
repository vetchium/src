package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUnauthorized(t *testing.T) {
	recorder := httptest.NewRecorder()
	Unauthorized(recorder)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
	if got := recorder.Header().Get("WWW-Authenticate"); got != `Bearer realm="login"` {
		t.Fatalf("WWW-Authenticate = %q", got)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("body = %q, want empty", recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "" {
		t.Fatalf("Content-Type = %q, want empty", got)
	}
}
