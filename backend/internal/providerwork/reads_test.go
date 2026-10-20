package providerwork

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

const (
	providerDID = "01900000-0000-7000-8000-000000000002"
	workID      = "01900000-0000-7000-8000-0000000000aa"
	engagement  = "01900000-0000-7000-8000-000000000001"
)

type fakeQueries struct {
	sqlc.Querier
	list    []sqlc.ListProviderWorkRow
	listed  sqlc.ListProviderWorkParams
	jobs    []sqlc.ListProviderJobsRow
	jobsAsk sqlc.ListProviderJobsParams
	work    sqlc.GetProviderWorkRow
	job     sqlc.GetProviderJobRow
	err     error
}

func (f *fakeQueries) ListProviderWork(
	_ context.Context, arg sqlc.ListProviderWorkParams,
) ([]sqlc.ListProviderWorkRow, error) {
	f.listed = arg
	return f.list, f.err
}

func (f *fakeQueries) ListProviderJobs(
	_ context.Context, arg sqlc.ListProviderJobsParams,
) ([]sqlc.ListProviderJobsRow, error) {
	f.jobsAsk = arg
	return f.jobs, f.err
}

func (f *fakeQueries) GetProviderWork(
	context.Context, sqlc.GetProviderWorkParams,
) (sqlc.GetProviderWorkRow, error) {
	return f.work, f.err
}

func (f *fakeQueries) GetProviderJob(
	context.Context, sqlc.GetProviderJobParams,
) (sqlc.GetProviderJobRow, error) {
	return f.job, f.err
}

func uuid(t *testing.T, value string) pgtype.UUID {
	t.Helper()
	id, err := dbvalue.ParseUUID(value)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func row(t *testing.T, id string, bucket int32, sort int64) sqlc.ListProviderWorkRow {
	return sqlc.ListProviderWorkRow{
		WorkID: uuid(t, id), EngagementID: uuid(t, engagement),
		ConsumerDomain: "client.test", ConsumerDisplayName: "Client",
		CapabilityOid: "interviewing", OpeningNumber: 1, OpeningTitle: "Engineer",
		EmployingCountry: dbvalue.Text("SG"), StageName: "Panel",
		ApplicantName: "Ada", RoutedAt: dbvalue.Timestamp(time.Now()),
		WorkStatus: "pending", Bucket: bucket, SortKey: sort,
	}
}

func TestListMapsRowsAndTrimsTheExtraRow(t *testing.T) {
	t.Parallel()
	second := "01900000-0000-7000-8000-0000000000bb"
	third := "01900000-0000-7000-8000-0000000000cc"
	queries := &fakeQueries{list: []sqlc.ListProviderWorkRow{
		row(t, workID, 0, 5), row(t, second, 1, -9), row(t, third, 1, -8),
	}}
	domain := orgs.OrgDomain("client.test")
	stage := "Panel"
	status := work.Pending
	response, err := Reader{Queries: queries}.List(context.Background(),
		work.PeerListWorkRequest{
			ProviderOrgDID: providerDID, ClientDomain: &domain,
			StageName: &stage, Status: &status, Limit: 2,
			After: &work.Position{Bucket: 0, Sort: 4, WorkID: workID},
		})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Items) != 2 || !response.HasMore {
		t.Fatalf("response = %+v", response)
	}
	first := response.Items[0]
	if first.Position != (work.Position{Bucket: 0, Sort: 5, WorkID: workID}) ||
		first.Item.Client.Domain != "client.test" ||
		first.Item.Opening.EmployingCountry == nil ||
		first.Item.Status != work.Pending || !first.Item.Valid() {
		t.Fatalf("first = %+v", first)
	}
	if queries.listed.PageLimit != 3 {
		t.Fatalf("page limit = %d, want the limit and one more", queries.listed.PageLimit)
	}
	if !queries.listed.AfterBucket.Valid || queries.listed.AfterSort.Int64 != 4 ||
		queries.listed.StageName.String != "Panel" ||
		queries.listed.WorkStatus.String != "pending" ||
		queries.listed.ClientDomain.String != "client.test" {
		t.Fatalf("params = %+v", queries.listed)
	}
}

func TestListWithoutAnAnchorStartsAtTheBeginning(t *testing.T) {
	t.Parallel()
	queries := &fakeQueries{}
	response, err := Reader{Queries: queries}.List(context.Background(),
		work.PeerListWorkRequest{ProviderOrgDID: providerDID, Limit: 5})
	if err != nil || response.Items == nil || len(response.Items) != 0 || response.HasMore {
		t.Fatalf("response = %+v, %v", response, err)
	}
	if queries.listed.AfterBucket.Valid || queries.listed.StageName.Valid {
		t.Fatalf("params = %+v", queries.listed)
	}
}

func TestGetAndGetJobAnswerOneMissForEverything(t *testing.T) {
	t.Parallel()
	queries := &fakeQueries{err: pgx.ErrNoRows}
	reader := Reader{Queries: queries}
	if _, err := reader.Get(context.Background(), work.PeerGetWorkRequest{
		ProviderOrgDID: providerDID, EngagementID: engagement, WorkID: workID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get error = %v", err)
	}
	if _, err := reader.GetJob(context.Background(), work.PeerGetJobRequest{
		ProviderOrgDID: providerDID, EngagementID: engagement, OpeningNumber: 1,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get job error = %v", err)
	}
	queries.err = errors.New("boom")
	if _, err := reader.Get(context.Background(), work.PeerGetWorkRequest{
		ProviderOrgDID: providerDID, EngagementID: engagement, WorkID: workID,
	}); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("a database failure is not a miss: %v", err)
	}
}

func TestGetJobDecodesTheLiveContent(t *testing.T) {
	t.Parallel()
	queries := &fakeQueries{job: sqlc.GetProviderJobRow{
		AssignmentID: uuid(t, workID), EngagementID: uuid(t, engagement),
		ConsumerDomain: "client.test", ConsumerDisplayName: "Client",
		OpeningNumber: 3, OpeningTitle: "Engineer", OpeningState: "published",
		AssignedAt:  dbvalue.Timestamp(time.Now()),
		LiveContent: []byte(`{"title":"Engineer","positions":2}`),
	}}
	detail, err := Reader{Queries: queries}.GetJob(context.Background(),
		work.PeerGetJobRequest{ProviderOrgDID: providerDID, EngagementID: engagement, OpeningNumber: 3})
	if err != nil || !detail.Job.Valid() || detail.Content.Title == nil ||
		*detail.Content.Positions != 2 {
		t.Fatalf("detail = %+v, %v", detail, err)
	}
}

func TestListJobsOrdersByAssignmentAndAnchors(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	queries := &fakeQueries{jobs: []sqlc.ListProviderJobsRow{
		{AssignmentID: uuid(t, workID), EngagementID: uuid(t, engagement),
			ConsumerDomain: "client.test", ConsumerDisplayName: "Client",
			OpeningNumber: 1, OpeningTitle: "Engineer", OpeningState: "published",
			AssignedAt: dbvalue.Timestamp(now)},
		{AssignmentID: uuid(t, "01900000-0000-7000-8000-0000000000bb"),
			EngagementID: uuid(t, engagement), ConsumerDomain: "client.test",
			ConsumerDisplayName: "Client", OpeningNumber: 2, OpeningTitle: "Other",
			OpeningState: "published", AssignedAt: dbvalue.Timestamp(now.Add(-time.Hour))},
	}}
	response, err := Reader{Queries: queries}.ListJobs(context.Background(),
		work.PeerListJobsRequest{
			ProviderOrgDID: providerDID, State: "published", Limit: 1,
			After: &work.JobPosition{AssignedAt: now.Add(time.Hour), AssignmentID: workID},
		})
	if err != nil || len(response.Jobs) != 1 || !response.HasMore {
		t.Fatalf("response = %+v, %v", response, err)
	}
	if response.Jobs[0].Position.AssignmentID != workID || !response.Jobs[0].Job.Valid() {
		t.Fatalf("job = %+v", response.Jobs[0])
	}
	if queries.jobsAsk.PageLimit != 2 || !queries.jobsAsk.AfterAssignedAt.Valid {
		t.Fatalf("params = %+v", queries.jobsAsk)
	}
}
