package hubapplicationclient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	hubspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"
)

func request() hubspec.MeshGetApplicationRequest {
	return hubspec.MeshGetApplicationRequest{
		ApplicationReference: hubspec.ApplicationReference{
			Domain: "example.com", OpeningNumber: 3, ApplicationNumber: 4,
		},
		ApplicantDID: "01900000-0000-7000-8000-000000000001",
	}
}

func application() hubspec.MyApplication {
	return hubspec.MyApplication{
		OrgDomain: "example.com", OrgDisplayName: "Example", OpeningNumber: 3,
		OpeningTitle: "Engineer", ApplicationNumber: 4, Status: hubspec.Applied,
		PendingActions: []hubspec.PendingActionKind{},
	}
}

func serve(t *testing.T, status int, mediaType string, body any) *Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer relay-secret" ||
				r.URL.Path != "/mesh/hub-applications/get" {
				w.WriteHeader(http.StatusTeapot)
				return
			}
			w.Header().Set("Content-Type", mediaType)
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(body)
		}))
	t.Cleanup(server.Close)
	return NewRelay(server.URL, "relay-secret", time.Second)
}

func TestRelayGetReturnsOnlyTheRequestedValidApplication(t *testing.T) {
	outcome, err := serve(t, 200, "application/json", application()).
		RelayGet(context.Background(), request())
	if err != nil || outcome.Result == nil || outcome.Problem != nil {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}
	offered := hubspec.MyApplicationDetail{
		MyApplication: application(),
		Offer: &hubspec.MyApplicationOffer{
			OfferNumber: 1, Status: "extended",
			LetterURL:      "https://media.sgp.vetchium.com/org-offer-letters/x",
			LetterByteSize: 1024, RespondBy: time.Now().Add(time.Hour),
			ExtendedAt: time.Now(),
		},
	}
	outcome, err = serve(t, 200, "application/json", offered).
		RelayGet(context.Background(), request())
	if err != nil || outcome.Result == nil || outcome.Result.Offer == nil ||
		outcome.Result.Offer.OfferNumber != 1 {
		t.Fatalf("offered outcome = %+v, err = %v", outcome, err)
	}
	withdrawn := offered
	withdrawnOffer := *offered.Offer
	withdrawnOffer.Status = "withdrawn"
	withdrawn.Offer = &withdrawnOffer
	other := application()
	other.ApplicationNumber = 5
	withStage := map[string]any{
		"org_domain": "example.com", "org_display_name": "Example",
		"opening_number": 3, "opening_title": "Engineer",
		"application_number": 4, "status": "applied",
		"pending_actions": []string{}, "stage_name": "Panel",
	}
	for name, body := range map[string]any{
		"another application": other, "an unknown field": withStage,
		"a withdrawn offer": withdrawn,
	} {
		if _, err := serve(t, 200, "application/json", body).
			RelayGet(context.Background(), request()); !errors.Is(err, ErrInvalidResponse) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestRelayGetPassesProblemsAndRejectsOtherAnswers(t *testing.T) {
	outcome, err := serve(t, 404, problem.MediaType,
		hubproblem.ApplicationNotFoundError).
		RelayGet(context.Background(), request())
	if err != nil || outcome.Problem == nil ||
		outcome.Problem.Type != hubproblem.ApplicationNotFoundError.Type {
		t.Fatalf("outcome = %+v, err = %v", outcome, err)
	}
	if _, err := serve(t, 502, "text/plain", "bad gateway").
		RelayGet(context.Background(), request()); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("err = %v", err)
	}
	if _, err := NewPeer(nil, time.Second).PeerGet(
		context.Background(), "usa1", request(),
	); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("unconfigured peer err = %v", err)
	}
}
