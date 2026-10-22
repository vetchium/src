package workfanout

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/workclient"
)

type fakePeers struct {
	work    map[directoryspec.TenantID]work.PeerListWorkResponse
	jobs    map[directoryspec.TenantID]work.PeerListJobsResponse
	failing map[directoryspec.TenantID]error
	slow    map[directoryspec.TenantID]bool
	problem map[directoryspec.TenantID]bool
}

func (f fakePeers) outcome(tenant directoryspec.TenantID, ctx context.Context) (bool, error) {
	if f.slow[tenant] {
		<-ctx.Done()
		return false, ctx.Err()
	}
	if err := f.failing[tenant]; err != nil {
		return false, err
	}
	return f.problem[tenant], nil
}

func (f fakePeers) RelayListWork(
	ctx context.Context, request work.RelayListWorkRequest,
) (workclient.Outcome[work.PeerListWorkResponse], error) {
	declared, err := f.outcome(request.Tenant, ctx)
	if err != nil {
		return workclient.Outcome[work.PeerListWorkResponse]{}, err
	}
	if declared {
		return workclient.Outcome[work.PeerListWorkResponse]{Problem: &problem.Details{Status: 503}}, nil
	}
	result := f.work[request.Tenant]
	return workclient.Outcome[work.PeerListWorkResponse]{Result: &result}, nil
}

func (f fakePeers) RelayListJobs(
	ctx context.Context, request work.RelayListJobsRequest,
) (workclient.Outcome[work.PeerListJobsResponse], error) {
	declared, err := f.outcome(request.Tenant, ctx)
	if err != nil {
		return workclient.Outcome[work.PeerListJobsResponse]{}, err
	}
	if declared {
		return workclient.Outcome[work.PeerListJobsResponse]{Problem: &problem.Details{Status: 503}}, nil
	}
	result := f.jobs[request.Tenant]
	return workclient.Outcome[work.PeerListJobsResponse]{Result: &result}, nil
}

func (f fakePeers) RelayListCreditedApplications(
	ctx context.Context, request work.RelayListCreditedApplicationsRequest,
) (workclient.Outcome[work.PeerListCreditedApplicationsResponse], error) {
	declared, err := f.outcome(request.Tenant, ctx)
	if err != nil {
		return workclient.Outcome[work.PeerListCreditedApplicationsResponse]{}, err
	}
	if declared {
		return workclient.Outcome[work.PeerListCreditedApplicationsResponse]{Problem: &problem.Details{Status: 503}}, nil
	}
	return workclient.Outcome[work.PeerListCreditedApplicationsResponse]{
		Result: &work.PeerListCreditedApplicationsResponse{Items: []work.CreditedApplicationSummary{}},
	}, nil
}

func entry(bucket int32, sort int64, id string) work.PeerWorkEntry {
	return work.PeerWorkEntry{
		Position: work.Position{Bucket: bucket, Sort: sort, WorkID: work.WorkID(id)},
	}
}

const (
	a = "01900000-0000-7000-8000-00000000000a"
	b = "01900000-0000-7000-8000-00000000000b"
	c = "01900000-0000-7000-8000-00000000000c"
	d = "01900000-0000-7000-8000-00000000000d"
)

func ids(entries []work.PeerWorkEntry) []string {
	list := []string{}
	for _, item := range entries {
		list = append(list, string(item.Position.WorkID))
	}
	return list
}

func fanout(peers fakePeers, tenants ...directoryspec.TenantID) Fanout {
	return Fanout{Peers: peers, Tenants: tenants, Deadline: 200 * time.Millisecond}
}

func TestListWorkMergesByBucketThenSortThenID(t *testing.T) {
	t.Parallel()
	peers := fakePeers{work: map[directoryspec.TenantID]work.PeerListWorkResponse{
		"sgp":  {Items: []work.PeerWorkEntry{entry(0, 50, c), entry(1, -10, a)}},
		"usa1": {Items: []work.PeerWorkEntry{entry(0, 20, d), entry(1, -10, b)}, HasMore: true},
	}}
	page := fanout(peers, "sgp", "usa1").ListWork(context.Background(),
		work.PeerListWorkRequest{Limit: 3})
	if got := ids(page.Entries); !slices.Equal(got, []string{d, c, a}) {
		t.Fatalf("entries = %v", got)
	}
	if !page.HasMore || len(page.Unavailable) != 0 {
		t.Fatalf("page = %+v", page)
	}
	all := fanout(peers, "sgp", "usa1").ListWork(context.Background(),
		work.PeerListWorkRequest{Limit: 10})
	if got := ids(all.Entries); !slices.Equal(got, []string{d, c, a, b}) {
		t.Fatalf("entries = %v", got)
	}
	if !all.HasMore {
		t.Fatal("a tenant that has more keeps the page open")
	}
}

func TestListWorkNamesTenantsThatDoNotAnswer(t *testing.T) {
	t.Parallel()
	peers := fakePeers{
		work:    map[directoryspec.TenantID]work.PeerListWorkResponse{"sgp": {Items: []work.PeerWorkEntry{entry(1, 1, a)}}},
		failing: map[directoryspec.TenantID]error{"usa1": errors.New("down")},
		slow:    map[directoryspec.TenantID]bool{"gone": true},
		problem: map[directoryspec.TenantID]bool{"deu": true},
	}
	page := fanout(peers, "sgp", "usa1", "gone", "deu").ListWork(
		context.Background(), work.PeerListWorkRequest{Limit: 5})
	if got := ids(page.Entries); !slices.Equal(got, []string{a}) {
		t.Fatalf("entries = %v", got)
	}
	want := []directoryspec.TenantID{"deu", "gone", "usa1"}
	if !slices.Equal(page.Unavailable, want) {
		t.Fatalf("unavailable = %v, want %v", page.Unavailable, want)
	}
}

func TestListJobsMergesNewestAssignmentFirst(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	job := func(age time.Duration, id string) work.PeerJobEntry {
		return work.PeerJobEntry{Position: work.JobPosition{
			AssignedAt: now.Add(-age), AssignmentID: id,
		}}
	}
	peers := fakePeers{jobs: map[directoryspec.TenantID]work.PeerListJobsResponse{
		"sgp":  {Jobs: []work.PeerJobEntry{job(time.Hour, a), job(3*time.Hour, c)}},
		"usa1": {Jobs: []work.PeerJobEntry{job(time.Hour, b), job(2*time.Hour, d)}},
	}}
	page := fanout(peers, "sgp", "usa1").ListJobs(context.Background(),
		work.PeerListJobsRequest{Limit: 3})
	got := []string{}
	for _, entry := range page.Entries {
		got = append(got, entry.Position.AssignmentID)
	}
	// The same instant lists the larger id first.
	if !slices.Equal(got, []string{b, a, d}) || !page.HasMore {
		t.Fatalf("entries = %v, page = %+v", got, page)
	}
}
