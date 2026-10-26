// Package work serves a provider's routed work: the work queue, the jobs of
// its `sourcing` engagements, and the writes that perform a routed stage
// (agent-guides/marketplace.md, MKT-ACC and MKT-WRK). The candidacies belong
// to the client Orgs' tenants, so every read is live from them and every
// write is a durable command to them.
package work

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const (
	workPurpose        = "orgs-list-work-queue-v1"
	jobsPurpose        = "orgs-list-jobs-v1"
	attributionPurpose = "orgs-list-credited-applications-v1"
)

// workFilters are the normalized filters a pagination key is bound to, so a
// key cannot resume a different list.
type workFilters struct {
	Client     string `json:"client,omitempty"`
	Capability string `json:"capability,omitempty"`
	Opening    int32  `json:"opening,omitempty"`
	Stage      string `json:"stage,omitempty"`
	Status     string `json:"status,omitempty"`
}

type workCursor struct {
	Filters  workFilters   `json:"filters"`
	Position work.Position `json:"position"`
}

func workFiltersOf(request work.ListWorkQueueRequest) workFilters {
	var filters workFilters
	if request.ClientDomain != nil {
		filters.Client = string(*request.ClientDomain)
	}
	if request.Capability != nil {
		filters.Capability = string(*request.Capability)
	}
	if request.OpeningNumber != nil {
		filters.Opening = int32(*request.OpeningNumber)
	}
	if request.StageName != nil {
		filters.Stage = *request.StageName
	}
	if request.Status != nil {
		filters.Status = string(*request.Status)
	}
	return filters
}

// ListWorkQueue merges the provider's routed work across every tenant, the
// candidacies with an upcoming interview first.
func ListWorkQueue(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request work.ListWorkQueueRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		peer := work.PeerListWorkRequest{
			ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(identity.OrgDID)),
			ClientDomain:   request.ClientDomain, Capability: request.Capability,
			OpeningNumber: request.OpeningNumber, StageName: request.StageName,
			Status: request.Status, Limit: request.EffectiveLimit(),
		}
		filters := workFiltersOf(request)
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), workPurpose, string(*request.PaginationKey))
			var cursor workCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				!reflect.DeepEqual(cursor.Filters, filters) || !cursor.Position.Valid() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			peer.After = &cursor.Position
		}
		page := s.WorkFanout.ListWork(r.Context(), peer)
		response := work.ListWorkQueueResponse{
			Items:              make([]work.WorkItem, 0, len(page.Entries)),
			UnavailableTenants: page.Unavailable,
		}
		for _, entry := range page.Entries {
			response.Items = append(response.Items, entry.Item)
		}
		if page.HasMore && len(page.Entries) > 0 {
			key, err := sign(s, workPurpose, workCursor{
				Filters: filters, Position: page.Entries[len(page.Entries)-1].Position,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode work cursor", err)
				return
			}
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func sign(s *orgsruntime.Server, purpose string, cursor any) (common.PaginationKey, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return common.PaginationKey(credentials.SignValue(
		s.CredentialSubkey("pagination"), purpose, payload)), nil
}

type jobFilters struct {
	Client  string `json:"client,omitempty"`
	State   string `json:"state"`
	Owner   string `json:"owner,omitempty"`
	Search  string `json:"search,omitempty"`
	Country string `json:"country,omitempty"`
}

type jobCursor struct {
	Filters  jobFilters       `json:"filters"`
	Position work.JobPosition `json:"position"`
}

// ListJobs merges the Openings assigned to the provider's `sourcing`
// engagements across every tenant, newest assignment first, each with the
// agency user who owns it. The owner filter is resolved here, where owners
// live, into the Jobs it names (MKT-OWN-004).
func ListJobs(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request work.ListJobsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		peer := work.PeerListJobsRequest{
			ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(identity.OrgDID)),
			ClientDomain:   request.ClientDomain, State: request.EffectiveState(),
			Search: request.Search, EmployingCountry: request.EmployingCountry,
			Limit: request.EffectiveLimit(),
		}
		filters := jobFilters{State: string(peer.State)}
		if request.ClientDomain != nil {
			filters.Client = string(*request.ClientDomain)
		}
		if request.Search != nil {
			filters.Search = string(*request.Search)
		}
		if request.EmployingCountry != nil {
			filters.Country = string(*request.EmployingCountry)
		}
		if request.OwnerEmail != nil {
			filters.Owner = string(*request.OwnerEmail)
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), jobsPurpose, string(*request.PaginationKey))
			var cursor jobCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				cursor.Filters != filters || !cursor.Position.Valid() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			peer.After = &cursor.Position
		}
		if request.OwnerEmail != nil {
			owned, err := s.Queries.ListOwnedJobs(r.Context(), sqlc.ListOwnedJobsParams{
				OrgDid: identity.OrgDID, EmailAddress: string(*request.OwnerEmail),
				RowLimit: work.MaxJobsPerOwner,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "list owned Jobs", err)
				return
			}
			if len(owned) == 0 {
				w.Header().Set("Cache-Control", "no-store")
				s.JSON(r.Context(), w, http.StatusOK, work.ListJobsResponse{
					Jobs: []work.Job{}, UnavailableTenants: []directoryspec.TenantID{},
				})
				return
			}
			peer.Openings = make([]work.JobReference, 0, len(owned))
			for _, job := range owned {
				peer.Openings = append(peer.Openings, work.JobReference{
					EngagementID:  marketplace.EngagementID(dbvalue.FormatUUID(job.EngagementID)),
					OpeningNumber: openings.OpeningNumber(job.OpeningNumber),
				})
			}
		}
		page := s.WorkFanout.ListJobs(r.Context(), peer)
		response := work.ListJobsResponse{
			Jobs:               make([]work.Job, 0, len(page.Entries)),
			UnavailableTenants: page.Unavailable,
		}
		for _, entry := range page.Entries {
			response.Jobs = append(response.Jobs, entry.Job)
		}
		if err := withOwners(r.Context(), s, identity.OrgDID, response.Jobs); err != nil {
			s.InternalError(r.Context(), w, "list Job owners", err)
			return
		}
		if page.HasMore && len(page.Entries) > 0 {
			key, err := sign(s, jobsPurpose, jobCursor{
				Filters: filters, Position: page.Entries[len(page.Entries)-1].Position,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode jobs cursor", err)
				return
			}
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// client finds the engagement this Org holds as provider and the tenant that
// homes the client Org. Both a missing engagement and an unknown client are
// the one answer for inaccessible work.
func client(
	ctx context.Context, s *orgsruntime.Server, identity middleware.OrgIdentity,
	engagementID string,
) (sqlc.GetProviderEngagementRow, directoryspec.TenantID, *problem.Details, error) {
	id, err := dbvalue.ParseUUID(engagementID)
	if err != nil {
		return sqlc.GetProviderEngagementRow{}, "", nil, err
	}
	row, err := s.Queries.GetProviderEngagement(ctx, sqlc.GetProviderEngagementParams{
		EngagementID: id, OrgDid: identity.OrgDID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, "", &orgsproblem.EngagementWorkNotFoundError, nil
	}
	if err != nil {
		return row, "", nil, err
	}
	tenant, details := s.ListingRead.HomeOf(ctx, row.ConsumerOrgDid)
	if details != nil {
		if details.Type == orgsproblem.ListingNotFoundError.Type {
			return row, "", &orgsproblem.EngagementWorkNotFoundError, nil
		}
		return row, "", details, nil
	}
	return row, tenant, nil, nil
}

// GetWorkItem reads one routed candidacy live from its client's tenant.
func GetWorkItem(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request work.WorkReference
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		ctx, cancel := context.WithTimeout(r.Context(), s.ListingDeadline)
		defer cancel()
		_, tenant, details, err := client(ctx, s, identity, string(request.EngagementID))
		if err != nil {
			s.InternalError(r.Context(), w, "find client tenant", err)
			return
		}
		if details != nil {
			s.Problem(r.Context(), w, *details)
			return
		}
		outcome, err := s.WorkRelay.RelayGetWork(ctx, work.RelayGetWorkRequest{
			Tenant: tenant,
			Request: work.PeerGetWorkRequest{
				ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(identity.OrgDID)),
				EngagementID:   request.EngagementID, WorkID: request.WorkID,
			},
		})
		answerRead(s, w, r, outcome.Result, outcome.Problem, err)
	}
}

// GetJob reads one assigned Opening live from its client's tenant.
func GetJob(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request work.JobReference
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		ctx, cancel := context.WithTimeout(r.Context(), s.ListingDeadline)
		defer cancel()
		_, tenant, details, err := client(ctx, s, identity, string(request.EngagementID))
		if err != nil {
			s.InternalError(r.Context(), w, "find client tenant", err)
			return
		}
		if details != nil {
			s.Problem(r.Context(), w, *details)
			return
		}
		outcome, err := s.WorkRelay.RelayGetJob(ctx, work.RelayGetJobRequest{
			Tenant: tenant,
			Request: work.PeerGetJobRequest{
				ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(identity.OrgDID)),
				EngagementID:   request.EngagementID, OpeningNumber: request.OpeningNumber,
			},
		})
		if err != nil || outcome.Problem != nil || outcome.Result == nil {
			answerRead(s, w, r, outcome.Result, outcome.Problem, err)
			return
		}
		jobDetail := *outcome.Result
		jobs := []work.Job{jobDetail.Job}
		if err := withOwners(r.Context(), s, identity.OrgDID, jobs); err != nil {
			s.InternalError(r.Context(), w, "read Job owner", err)
			return
		}
		jobDetail.Job = jobs[0]
		sugRows, err := s.Queries.ListJobSuggestedContacts(r.Context(), sqlc.ListJobSuggestedContactsParams{
			OrgDid:         identity.OrgDID,
			ConsumerDomain: string(jobDetail.Job.Client.Domain),
			OpeningNumber:  int32(jobDetail.Job.Opening.Number),
		})
		if err != nil {
			s.InternalError(r.Context(), w, "list job suggested contacts", err)
			return
		}
		jobDetail.SuggestedContacts = make([]work.JobSuggestedContact, 0, len(sugRows))
		for _, sug := range sugRows {
			jobDetail.SuggestedContacts = append(jobDetail.SuggestedContacts, work.JobSuggestedContact{
				ContactID:   contacts.ContactID(dbvalue.FormatUUID(sug.ContactID)),
				DisplayName: common.DisplayName(sug.DisplayName),
				Handle:      hubspec.HubHandle(sug.Handle),
				SuggestedAt: sug.SuggestedAt.Time.UTC(),
			})
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, jobDetail)
	}
}

// answerRead writes a client tenant's answer, or the one a provider gets for
// work it cannot reach, or an unavailable tenant.
func answerRead[T any](
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	result *T, declared *problem.Details, err error,
) {
	if err == nil && declared != nil &&
		declared.Type == orgsproblem.EngagementWorkNotFoundError.Type {
		s.Problem(r.Context(), w, orgsproblem.EngagementWorkNotFoundError)
		return
	}
	if err != nil || declared != nil {
		s.WarnContext(r.Context(), "client tenant did not answer",
			"event", "work_read_unavailable", "error", err)
		s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK, *result)
}

type creditedFilters struct {
	Client  string `json:"client,omitempty"`
	Opening int32  `json:"opening,omitempty"`
	Route   string `json:"route,omitempty"`
	Status  string `json:"status,omitempty"`
	Contact string `json:"contact,omitempty"`
}

type creditedCursor struct {
	Filters creditedFilters       `json:"filters"`
	After   work.CreditedPosition `json:"after"`
}

func creditedFiltersOf(request work.ListCreditedApplicationsRequest) creditedFilters {
	var f creditedFilters
	if request.ClientDomain != nil {
		f.Client = string(*request.ClientDomain)
	}
	if request.OpeningNumber != nil {
		f.Opening = int32(*request.OpeningNumber)
	}
	if request.Route != nil {
		f.Route = string(*request.Route)
	}
	if request.Status != nil {
		f.Status = string(*request.Status)
	}
	if request.ContactID != nil {
		f.Contact = string(*request.ContactID)
	}
	return f
}

// ListCreditedApplications lists the agency's credited applications across
// every client tenant, newest first (MKT-UI-009), naming the tenants that did
// not answer.
func ListCreditedApplications(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request work.ListCreditedApplicationsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		filters := creditedFiltersOf(request)
		peer := work.PeerListCreditedApplicationsRequest{
			ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(identity.OrgDID)),
			ClientDomain:   request.ClientDomain,
			OpeningNumber:  request.OpeningNumber,
			Route:          request.Route,
			Status:         request.Status,
			Limit:          request.EffectiveLimit(),
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), attributionPurpose, string(*request.PaginationKey))
			var cursor creditedCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				cursor.Filters != filters || !cursor.After.Valid() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			peer.After = &cursor.After
		}
		if request.ContactID != nil {
			contactID, err := dbvalue.ParseUUID(string(*request.ContactID))
			if err != nil {
				s.InternalError(r.Context(), w, "parse Contact id", err)
				return
			}
			contact, err := s.Queries.GetOrgContact(r.Context(), sqlc.GetOrgContactParams{
				OrgDid: identity.OrgDID, ContactID: contactID,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				w.Header().Set("Cache-Control", "no-store")
				s.JSON(r.Context(), w, http.StatusOK, work.ListCreditedApplicationsResponse{
					Items:              []work.CreditedApplicationSummary{},
					UnavailableTenants: []directoryspec.TenantID{},
				})
				return
			}
			if err != nil {
				s.InternalError(r.Context(), w, "read Contact", err)
				return
			}
			peer.ApplicantDIDs = []hubspec.HubUserDID{
				hubspec.HubUserDID(dbvalue.FormatUUID(contact.HubUserDid)),
			}
		}
		page := s.WorkFanout.ListCreditedApplications(r.Context(), peer)
		applicants := make([]pgtype.UUID, 0, len(page.Entries))
		for _, entry := range page.Entries {
			did, err := dbvalue.ParseUUID(string(entry.ApplicantDID))
			if err != nil {
				s.InternalError(r.Context(), w, "parse applicant DID", err)
				return
			}
			applicants = append(applicants, did)
		}
		contactOf := map[string]contacts.ContactID{}
		if len(applicants) > 0 {
			rows, err := s.Queries.ListOrgContactsByHubUsers(r.Context(), sqlc.ListOrgContactsByHubUsersParams{
				OrgDid: identity.OrgDID, HubUserDids: applicants,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "list Contacts of applicants", err)
				return
			}
			for _, row := range rows {
				contactOf[dbvalue.FormatUUID(row.HubUserDid)] =
					contacts.ContactID(dbvalue.FormatUUID(row.ContactID))
			}
		}
		response := work.ListCreditedApplicationsResponse{
			Items:              make([]work.CreditedApplicationSummary, 0, len(page.Entries)),
			UnavailableTenants: page.Unavailable,
		}
		for _, entry := range page.Entries {
			item := entry.Item
			if contactID, ok := contactOf[string(entry.ApplicantDID)]; ok {
				item.ContactID = &contactID
			}
			response.Items = append(response.Items, item)
		}
		if page.HasMore && len(page.Entries) > 0 {
			encoded, err := json.Marshal(creditedCursor{
				Filters: filters, After: page.Entries[len(page.Entries)-1].Position,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode attribution cursor", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), attributionPurpose, encoded))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
