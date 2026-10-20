package workclient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/problem"
)

const (
	workA      = "01900000-0000-7000-8000-00000000000a"
	workB      = "01900000-0000-7000-8000-00000000000b"
	engagement = "01900000-0000-7000-8000-000000000001"
)

func item(id string) work.WorkItem {
	return work.WorkItem{
		WorkID:       work.WorkID(id),
		EngagementID: engagement,
		Client:       marketplace.EngagementCounterparty{Domain: "client.test", DisplayName: "Client"},
		Capability:   marketplace.Interviewing,
		Opening:      work.WorkOpening{Number: 1, Title: "Engineer"},
		StageName:    "Panel", Status: work.Pending,
		ApplicantName: common.DisplayName("Ada"), RoutedAt: time.Now(),
	}
}

func entry(id string, bucket int32, sort int64) work.PeerWorkEntry {
	return work.PeerWorkEntry{
		Position: work.Position{Bucket: bucket, Sort: sort, WorkID: work.WorkID(id)},
		Item:     item(id),
	}
}

func serve(t *testing.T, status int, contentType string, body any) *Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", contentType)
		w.WriteHeader(status)
		data, _ := json.Marshal(body)
		_, _ = w.Write(data)
	}))
	t.Cleanup(server.Close)
	return NewRelay(server.URL, "secret", time.Second)
}

func listRequest(limit int32) work.RelayListWorkRequest {
	return work.RelayListWorkRequest{
		Tenant: "sgp",
		Request: work.PeerListWorkRequest{
			ProviderOrgDID: orgs.OrgDID("01900000-0000-7000-8000-000000000002"),
			Limit:          limit,
		},
	}
}

func TestRelayListWorkReturnsAValidPage(t *testing.T) {
	t.Parallel()
	client := serve(t, 200, "application/json", work.PeerListWorkResponse{
		Items:   []work.PeerWorkEntry{entry(workA, 0, 5), entry(workB, 1, -5)},
		HasMore: true,
	})
	outcome, err := client.RelayListWork(context.Background(), listRequest(2))
	if err != nil || outcome.Result == nil || len(outcome.Result.Items) != 2 {
		t.Fatalf("outcome = %+v, %v", outcome, err)
	}
}

func TestRelayListWorkReturnsAProblem(t *testing.T) {
	t.Parallel()
	client := serve(t, 404, problem.MediaType, problem.Details{
		Type: "vetchium-problem-details/org-engagement-work-not-found", Status: 404,
	})
	outcome, err := client.RelayGetWork(context.Background(), work.RelayGetWorkRequest{
		Tenant: "sgp",
		Request: work.PeerGetWorkRequest{
			ProviderOrgDID: "01900000-0000-7000-8000-000000000002",
			EngagementID:   engagement, WorkID: workA,
		},
	})
	if err != nil || outcome.Problem == nil || outcome.Problem.Status != 404 || outcome.Result != nil {
		t.Fatalf("outcome = %+v, %v", outcome, err)
	}
	client = serve(t, 200, problem.MediaType, problem.Details{Type: "x", Status: 404})
	if _, err := client.RelayListWork(context.Background(), listRequest(2)); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("inconsistent problem error = %v", err)
	}
}

func TestRelayListWorkHoldsATenantToItsContract(t *testing.T) {
	t.Parallel()
	wrongOrder := []work.PeerWorkEntry{entry(workB, 1, 1), entry(workA, 0, 1)}
	mismatch := entry(workA, 0, 1)
	mismatch.Position.WorkID = workB
	invalid := entry(workA, 0, 1)
	invalid.Item.StageName = ""
	tests := []struct {
		name  string
		items []work.PeerWorkEntry
		limit int32
	}{
		{"over the limit", []work.PeerWorkEntry{entry(workA, 0, 1), entry(workB, 0, 2)}, 1},
		{"out of order", wrongOrder, 5},
		{"position not the item", []work.PeerWorkEntry{mismatch}, 5},
		{"invalid item", []work.PeerWorkEntry{invalid}, 5},
		{"missing items", nil, 5},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := serve(t, 200, "application/json", work.PeerListWorkResponse{Items: test.items})
			if _, err := client.RelayListWork(context.Background(), listRequest(test.limit)); !errors.Is(err, ErrInvalidResponse) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestPositionsOrderBucketThenSortThenID(t *testing.T) {
	t.Parallel()
	first := work.Position{Bucket: 0, Sort: 9, WorkID: workA}
	for _, later := range []work.Position{
		{Bucket: 1, Sort: -9, WorkID: workA},
		{Bucket: 0, Sort: 10, WorkID: workA},
		{Bucket: 0, Sort: 9, WorkID: workB},
	} {
		if !PositionAfter(later, first) || PositionAfter(first, later) {
			t.Fatalf("%+v should sort after %+v", later, first)
		}
	}
	if PositionAfter(first, first) {
		t.Fatal("a position is not after itself")
	}
	now := time.Now()
	newer := work.JobPosition{AssignedAt: now, AssignmentID: workA}
	older := work.JobPosition{AssignedAt: now.Add(-time.Hour), AssignmentID: workB}
	if !JobAfter(older, newer) || JobAfter(newer, older) {
		t.Fatal("jobs list newest first")
	}
	if !JobAfter(work.JobPosition{AssignedAt: now, AssignmentID: workA}, work.JobPosition{AssignedAt: now, AssignmentID: workB}) {
		t.Fatal("the larger id lists first at one instant")
	}
}

func TestPeerEndpointsNeedATenantAndATLSConfig(t *testing.T) {
	t.Parallel()
	client := NewPeer(nil, time.Second)
	if _, err := client.PeerListWork(context.Background(), "sgp", work.PeerListWorkRequest{}); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("error = %v", err)
	}
}
