// Package providerwork is the client tenant's side of a provider's work
// (agent-guides/marketplace.md, MKT-ACC and MKT-WRK): the reads it answers
// and the commands it executes as the authority of a routed candidacy. A
// provider reaches a candidacy only through its route, and every miss is one
// answer, ErrNotFound.
package providerwork

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/applicationview"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/hubapplications"
)

// ErrNotFound is the one answer for work the provider may not reach.
var ErrNotFound = errors.New("provider work not found")

// ErrInvalidCursor indicates an invalid statement pagination key.
var ErrInvalidCursor = errors.New("invalid statement cursor")

// Reader answers a provider's reads from this tenant's database.
type Reader struct {
	Queries sqlc.Querier
}

// itemFields are the columns a list row and a detail row share.
type itemFields struct {
	workID, engagementID                   pgtype.UUID
	domain, displayName, capability        string
	openingNumber                          int32
	openingTitle, stageName, applicantName string
	country                                pgtype.Text
	routedAt, nextInterview                pgtype.Timestamptz
	status                                 string
}

func (f itemFields) item() work.WorkItem {
	item := work.WorkItem{
		WorkID:       work.WorkID(dbvalue.FormatUUID(f.workID)),
		EngagementID: marketplace.EngagementID(dbvalue.FormatUUID(f.engagementID)),
		Client: marketplace.EngagementCounterparty{
			Domain: orgs.OrgDomain(f.domain), DisplayName: f.displayName,
		},
		Capability: marketplace.Capability(f.capability),
		Opening: work.WorkOpening{
			Number: openings.OpeningNumber(f.openingNumber), Title: f.openingTitle,
		},
		StageName:     f.stageName,
		Status:        work.WorkStatus(f.status),
		ApplicantName: common.DisplayName(f.applicantName),
		RoutedAt:      f.routedAt.Time.UTC(),
	}
	if f.country.Valid {
		country := common.CountryCode(f.country.String)
		item.Opening.EmployingCountry = &country
	}
	if f.nextInterview.Valid {
		next := f.nextInterview.Time.UTC()
		item.NextInterviewAt = &next
	}
	return item
}

// List reads one page of the provider's routed work in this tenant.
func (r Reader) List(
	ctx context.Context, request work.PeerListWorkRequest,
) (work.PeerListWorkResponse, error) {
	provider, err := dbvalue.ParseUUID(string(request.ProviderOrgDID))
	if err != nil {
		return work.PeerListWorkResponse{}, err
	}
	params := sqlc.ListProviderWorkParams{
		ProviderOrgDid: provider, PageLimit: request.Limit + 1,
	}
	if request.ClientDomain != nil {
		params.ClientDomain = dbvalue.Text(string(*request.ClientDomain))
	}
	if request.Capability != nil {
		params.CapabilityOid = dbvalue.Text(string(*request.Capability))
	}
	if request.OpeningNumber != nil {
		params.OpeningNumber = pgtype.Int4{Int32: int32(*request.OpeningNumber), Valid: true}
	}
	if request.StageName != nil {
		params.StageName = dbvalue.Text(*request.StageName)
	}
	if request.Status != nil {
		params.WorkStatus = dbvalue.Text(string(*request.Status))
	}
	if request.After != nil {
		after, err := dbvalue.ParseUUID(string(request.After.WorkID))
		if err != nil {
			return work.PeerListWorkResponse{}, err
		}
		params.AfterBucket = pgtype.Int4{Int32: request.After.Bucket, Valid: true}
		params.AfterSort = pgtype.Int8{Int64: request.After.Sort, Valid: true}
		params.AfterWorkID = after
	}
	rows, err := r.Queries.ListProviderWork(ctx, params)
	if err != nil {
		return work.PeerListWorkResponse{}, fmt.Errorf("list provider work: %w", err)
	}
	response := work.PeerListWorkResponse{Items: []work.PeerWorkEntry{}}
	if len(rows) > int(request.Limit) {
		rows = rows[:request.Limit]
		response.HasMore = true
	}
	for _, row := range rows {
		fields := itemFields{
			workID: row.WorkID, engagementID: row.EngagementID,
			domain: row.ConsumerDomain, displayName: row.ConsumerDisplayName,
			capability: row.CapabilityOid, openingNumber: row.OpeningNumber,
			openingTitle: row.OpeningTitle, stageName: row.StageName,
			applicantName: row.ApplicantName, country: row.EmployingCountry,
			routedAt: row.RoutedAt, nextInterview: row.NextInterviewAt,
			status: row.WorkStatus,
		}
		item := fields.item()
		response.Items = append(response.Items, work.PeerWorkEntry{
			Position: work.Position{
				Bucket: row.Bucket, Sort: row.SortKey, WorkID: item.WorkID,
			},
			Item: item,
		})
	}
	return response, nil
}

// Get reads one routed candidacy and the provider's own work on it.
func (r Reader) Get(
	ctx context.Context, request work.PeerGetWorkRequest,
) (work.WorkDetail, error) {
	provider, err := dbvalue.ParseUUID(string(request.ProviderOrgDID))
	if err != nil {
		return work.WorkDetail{}, err
	}
	workID, err := dbvalue.ParseUUID(string(request.WorkID))
	if err != nil {
		return work.WorkDetail{}, err
	}
	engagementID, err := dbvalue.ParseUUID(string(request.EngagementID))
	if err != nil {
		return work.WorkDetail{}, err
	}
	row, err := r.Queries.GetProviderWork(ctx, sqlc.GetProviderWorkParams{
		WorkID: workID, EngagementID: engagementID, ProviderOrgDid: provider,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return work.WorkDetail{}, ErrNotFound
	}
	if err != nil {
		return work.WorkDetail{}, fmt.Errorf("get provider work: %w", err)
	}
	fields := itemFields{
		workID: row.WorkID, engagementID: row.EngagementID,
		domain: row.ConsumerDomain, displayName: row.ConsumerDisplayName,
		capability: row.CapabilityOid, openingNumber: row.OpeningNumber,
		openingTitle: row.OpeningTitle, stageName: row.StageName,
		applicantName: row.ApplicantName, country: row.EmployingCountry,
		routedAt: row.RoutedAt, nextInterview: row.NextInterviewAt,
		status: row.WorkStatus,
	}
	detail := work.WorkDetail{Item: fields.item()}
	if err := json.Unmarshal(row.Snapshot, &detail.Snapshot); err != nil {
		return work.WorkDetail{}, fmt.Errorf("decode snapshot: %w", err)
	}
	if row.CoverNote.Valid {
		note := applications.ApplicationCoverNote(row.CoverNote.String)
		detail.CoverNote = &note
	}
	if detail.Interviews, err = applicationview.Interviews(row.Interviews); err != nil {
		return work.WorkDetail{}, err
	}
	if len(row.Assessment) > 0 {
		var result applications.AssessmentResult
		if err := json.Unmarshal(row.Assessment, &result); err != nil {
			return work.WorkDetail{}, fmt.Errorf("decode assessment: %w", err)
		}
		result.RecordedAt = result.RecordedAt.UTC()
		detail.Assessment = &result
	}
	if len(row.BackgroundCheck) > 0 {
		checks, err := applicationview.BackgroundChecks(
			append(append([]byte{'['}, row.BackgroundCheck...), ']'))
		if err != nil {
			return work.WorkDetail{}, err
		}
		detail.BackgroundCheck = &checks[0]
	}
	return detail, nil
}

func jobOf(
	engagementID pgtype.UUID, domain, displayName string,
	number int32, title string, country pgtype.Text,
	state sqlc.VetchiumOrgOpeningState, assigned time.Time,
	creditedCount int32,
) work.Job {
	job := work.Job{
		EngagementID: marketplace.EngagementID(dbvalue.FormatUUID(engagementID)),
		Client: marketplace.EngagementCounterparty{
			Domain: orgs.OrgDomain(domain), DisplayName: displayName,
		},
		Opening:       work.WorkOpening{Number: openings.OpeningNumber(number), Title: title},
		State:         openings.OpeningState(state),
		AssignedAt:    assigned.UTC(),
		CreditedCount: creditedCount,
	}
	if country.Valid {
		code := common.CountryCode(country.String)
		job.Opening.EmployingCountry = &code
	}
	return job
}

// ListJobs reads one page of the Openings assigned to the provider's
// `sourcing` engagements in this tenant.
func (r Reader) ListJobs(
	ctx context.Context, request work.PeerListJobsRequest,
) (work.PeerListJobsResponse, error) {
	provider, err := dbvalue.ParseUUID(string(request.ProviderOrgDID))
	if err != nil {
		return work.PeerListJobsResponse{}, err
	}
	params := sqlc.ListProviderJobsParams{
		ProviderOrgDid: provider, OpeningState: string(request.State),
		PageLimit: request.Limit + 1,
	}
	if request.ClientDomain != nil {
		params.ClientDomain = dbvalue.Text(string(*request.ClientDomain))
	}
	if request.After != nil {
		after, err := dbvalue.ParseUUID(request.After.AssignmentID)
		if err != nil {
			return work.PeerListJobsResponse{}, err
		}
		params.AfterAssignedAt = dbvalue.Timestamp(request.After.AssignedAt)
		params.AfterAssignmentID = after
	}
	rows, err := r.Queries.ListProviderJobs(ctx, params)
	if err != nil {
		return work.PeerListJobsResponse{}, fmt.Errorf("list provider jobs: %w", err)
	}
	response := work.PeerListJobsResponse{Jobs: []work.PeerJobEntry{}}
	if len(rows) > int(request.Limit) {
		rows = rows[:request.Limit]
		response.HasMore = true
	}
	for _, row := range rows {
		response.Jobs = append(response.Jobs, work.PeerJobEntry{
			Position: work.JobPosition{
				AssignedAt:   row.AssignedAt.Time.UTC(),
				AssignmentID: dbvalue.FormatUUID(row.AssignmentID),
			},
			Job: jobOf(row.EngagementID, row.ConsumerDomain,
				row.ConsumerDisplayName, row.OpeningNumber, row.OpeningTitle,
				row.EmployingCountry, row.OpeningState, row.AssignedAt.Time,
				row.CreditedCount),
		})
	}
	return response, nil
}

// GetJob reads one assigned Opening and its live content.
func (r Reader) GetJob(
	ctx context.Context, request work.PeerGetJobRequest,
) (work.JobDetail, error) {
	provider, err := dbvalue.ParseUUID(string(request.ProviderOrgDID))
	if err != nil {
		return work.JobDetail{}, err
	}
	engagementID, err := dbvalue.ParseUUID(string(request.EngagementID))
	if err != nil {
		return work.JobDetail{}, err
	}
	row, err := r.Queries.GetProviderJob(ctx, sqlc.GetProviderJobParams{
		EngagementID: engagementID, ProviderOrgDid: provider,
		OpeningNumber: int32(request.OpeningNumber),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return work.JobDetail{}, ErrNotFound
	}
	if err != nil {
		return work.JobDetail{}, fmt.Errorf("get provider job: %w", err)
	}
	detail := work.JobDetail{
		Job: jobOf(row.EngagementID,
			row.ConsumerDomain, row.ConsumerDisplayName, row.OpeningNumber,
			row.OpeningTitle, row.EmployingCountry, row.OpeningState,
			row.AssignedAt.Time, row.CreditedCount),
		CreditedApplications: make([]work.JobCreditedApplication, 0),
		SuggestedContacts:    make([]work.JobSuggestedContact, 0),
	}
	if len(row.LiveContent) > 0 {
		if err := json.Unmarshal(row.LiveContent, &detail.Content); err != nil {
			return work.JobDetail{}, fmt.Errorf("decode job content: %w", err)
		}
	}
	appRows, err := r.Queries.ListJobCreditedApplications(ctx, sqlc.ListJobCreditedApplicationsParams{
		EngagementID:   engagementID,
		ProviderOrgDid: provider,
		OpeningNumber:  int32(request.OpeningNumber),
	})
	if err != nil {
		return work.JobDetail{}, fmt.Errorf("list job credited applications: %w", err)
	}
	for _, appRow := range appRows {
		status, err := hubapplications.Status(appRow.ApplicationState, appRow.CurrentStageKind)
		if err != nil {
			return work.JobDetail{}, fmt.Errorf("derive credited application status: %w", err)
		}
		detail.CreditedApplications = append(detail.CreditedApplications, work.JobCreditedApplication{
			ApplicationNumber: applications.ApplicationNumber(appRow.ApplicationNumber),
			Route:             marketplace.ReferralRoute(appRow.ReferralRoute),
			Status:            status,
			AppliedAt:         appRow.AppliedAt.Time.UTC(),
		})
	}
	return detail, nil
}

// ListCreditedApplications reads credited applications for one provider across its sourcing engagements.
func (r Reader) ListCreditedApplications(
	ctx context.Context, request work.PeerListCreditedApplicationsRequest,
) (work.PeerListCreditedApplicationsResponse, error) {
	provider, err := dbvalue.ParseUUID(string(request.ProviderOrgDID))
	if err != nil {
		return work.PeerListCreditedApplicationsResponse{}, err
	}
	params := sqlc.ListPeerCreditedApplicationsParams{
		ProviderOrgDid: provider,
		PageLimit:      int32(request.Limit),
	}
	if request.ClientDomain != nil {
		params.ClientDomain = dbvalue.Text(string(*request.ClientDomain))
	}
	if request.OpeningNumber != nil {
		params.OpeningNumber = pgtype.Int4{Int32: int32(*request.OpeningNumber), Valid: true}
	}
	if request.Route != nil {
		params.ReferralRoute = dbvalue.Text(string(*request.Route))
	}
	rows, err := r.Queries.ListPeerCreditedApplications(ctx, params)
	if err != nil {
		return work.PeerListCreditedApplicationsResponse{}, fmt.Errorf("list peer credited applications: %w", err)
	}
	items := make([]work.CreditedApplicationSummary, 0, len(rows))
	for _, row := range rows {
		status, err := hubapplications.Status(row.ApplicationState, row.CurrentStageKind)
		if err != nil {
			return work.PeerListCreditedApplicationsResponse{}, fmt.Errorf("derive status: %w", err)
		}
		if request.Status != nil && status != *request.Status {
			continue
		}
		item := work.CreditedApplicationSummary{
			EngagementID: marketplace.EngagementID(dbvalue.FormatUUID(row.EngagementID)),
			Client: marketplace.EngagementCounterparty{
				Domain:      orgs.OrgDomain(row.ConsumerDomain),
				DisplayName: row.ConsumerDisplayName,
			},
			Opening: work.WorkOpening{
				Number: openings.OpeningNumber(row.OpeningNumber),
				Title:  row.OpeningTitle,
			},
			ApplicationNumber: applications.ApplicationNumber(row.ApplicationNumber),
			Route:             marketplace.ReferralRoute(row.ReferralRoute),
			Status:            status,
			AppliedAt:         row.AppliedAt.Time.UTC(),
		}
		if row.EmployingCountry.Valid {
			code := common.CountryCode(row.EmployingCountry.String)
			item.Opening.EmployingCountry = &code
		}
		if row.ApplicantDid.Valid {
			did := directoryspec.PrincipalDID(dbvalue.FormatUUID(row.ApplicantDid))
			item.ApplicantDID = &did
		}
		items = append(items, item)
	}
	return work.PeerListCreditedApplicationsResponse{Items: items}, nil
}

type statementCursor struct {
	EngagementID string `json:"e"`
	Month        string `json:"m"`
	Date         string `json:"d"`
	FactID       string `json:"id"`
}

func encodeStatementCursor(engagementID, month, date, factID string) string {
	payload, _ := json.Marshal(statementCursor{
		EngagementID: engagementID,
		Month:        month,
		Date:         date,
		FactID:       factID,
	})
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeStatementCursor(raw, expectedEngagement, expectedMonth string) (time.Time, pgtype.UUID, bool) {
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return time.Time{}, pgtype.UUID{}, false
	}
	var cursor statementCursor
	if err := json.Unmarshal(data, &cursor); err != nil {
		return time.Time{}, pgtype.UUID{}, false
	}
	if cursor.EngagementID != expectedEngagement || cursor.Month != expectedMonth {
		return time.Time{}, pgtype.UUID{}, false
	}
	d, err := time.Parse("2006-01-02", cursor.Date)
	if err != nil {
		return time.Time{}, pgtype.UUID{}, false
	}
	id, err := dbvalue.ParseUUID(cursor.FactID)
	if err != nil {
		return time.Time{}, pgtype.UUID{}, false
	}
	return d, id, true
}

// ReadActivityStatement reads billable facts for one engagement and month from the database.
func (r Reader) ReadActivityStatement(
	ctx context.Context,
	engagementID string,
	expectedOrgDID pgtype.UUID,
	isConsumer bool,
	month marketplace.StatementMonth,
	paginationKey *common.PaginationKey,
	limit int32,
) (marketplace.GetActivityStatementResponse, error) {
	engID, err := dbvalue.ParseUUID(engagementID)
	if err != nil {
		return marketplace.GetActivityStatementResponse{}, err
	}
	snapshot, err := r.Queries.GetOrgEngagementSnapshot(ctx, engID)
	if errors.Is(err, pgx.ErrNoRows) {
		return marketplace.GetActivityStatementResponse{}, ErrNotFound
	}
	if err != nil {
		return marketplace.GetActivityStatementResponse{}, fmt.Errorf("read engagement snapshot: %w", err)
	}
	if isConsumer {
		if snapshot.ConsumerOrgDid != expectedOrgDID {
			return marketplace.GetActivityStatementResponse{}, ErrNotFound
		}
	} else {
		if snapshot.ProviderOrgDid != expectedOrgDID {
			return marketplace.GetActivityStatementResponse{}, ErrNotFound
		}
	}

	startTime, err := time.Parse("2006-01", string(month))
	if err != nil {
		return marketplace.GetActivityStatementResponse{}, fmt.Errorf("invalid month: %w", err)
	}
	startDate := startTime
	endDate := startTime.AddDate(0, 1, -1)

	effLimit := int(limit)
	if effLimit < 1 {
		effLimit = 50
	} else if effLimit > 100 {
		effLimit = 100
	}

	params := sqlc.ListActivityStatementFactsParams{
		EngagementID: engID,
		StartDate:    pgtype.Date{Time: startDate, Valid: true},
		EndDate:      pgtype.Date{Time: endDate, Valid: true},
		PageLimit:    int32(effLimit) + 1,
	}

	if paginationKey != nil {
		afterDate, afterFactID, ok := decodeStatementCursor(string(*paginationKey), engagementID, string(month))
		if !ok {
			return marketplace.GetActivityStatementResponse{}, ErrInvalidCursor
		}
		params.AfterDate = pgtype.Date{Time: afterDate, Valid: true}
		params.AfterFactID = afterFactID
	}

	rows, err := r.Queries.ListActivityStatementFacts(ctx, params)
	if err != nil {
		return marketplace.GetActivityStatementResponse{}, fmt.Errorf("list activity statement facts: %w", err)
	}

	hasMore := len(rows) > effLimit
	if hasMore {
		rows = rows[:effLimit]
	}

	items := make([]marketplace.ActivityStatementItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, marketplace.ActivityStatementItem{
			FactID:               dbvalue.FormatUUID(row.FactID),
			Date:                 row.FactDate.Time.Format("2006-01-02"),
			Fact:                 marketplace.BillableFactKind(row.FactKind),
			OpeningNumber:        openings.OpeningNumber(row.OpeningNumber),
			OpeningTitle:         row.OpeningTitle,
			ApplicationNumber:    row.ApplicationNumber,
			ApplicantDisplayName: row.ApplicantDisplayName,
			Corrected:            row.Corrected,
		})
	}

	response := marketplace.GetActivityStatementResponse{
		EngagementID: marketplace.EngagementID(engagementID),
		Month:        month,
		Items:        items,
	}

	if hasMore {
		last := rows[len(rows)-1]
		key := encodeStatementCursor(engagementID, string(month), last.FactDate.Time.Format("2006-01-02"), dbvalue.FormatUUID(last.FactID))
		pk := common.PaginationKey(key)
		response.NextPaginationKey = &pk
	}

	return response, nil
}

// GetActivityStatement reads billable facts for one provider across one of its engagements.
func (r Reader) GetActivityStatement(
	ctx context.Context, request work.PeerGetActivityStatementRequest,
) (work.PeerGetActivityStatementResponse, error) {
	providerDID, err := dbvalue.ParseUUID(string(request.ProviderOrgDID))
	if err != nil {
		return work.PeerGetActivityStatementResponse{}, err
	}
	res, err := r.ReadActivityStatement(
		ctx, string(request.EngagementID), providerDID, false, request.Month, request.PaginationKey, request.Limit,
	)
	if err != nil {
		return work.PeerGetActivityStatementResponse{}, err
	}
	return work.PeerGetActivityStatementResponse{
		EngagementID:      res.EngagementID,
		Month:             res.Month,
		Items:             res.Items,
		NextPaginationKey: res.NextPaginationKey,
	}, nil
}
