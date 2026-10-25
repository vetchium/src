package work

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const ownerReplayWindow = 24 * time.Hour

// withOwners sets each Job's owner and owner version from this tenant's
// owner rows (MKT-OWN-001); a Job without a row has version 0.
func withOwners(
	ctx context.Context, s *orgsruntime.Server, orgDID pgtype.UUID, jobs []work.Job,
) error {
	if len(jobs) == 0 {
		return nil
	}
	keys := make([]string, 0, len(jobs))
	for _, job := range jobs {
		id, err := dbvalue.ParseUUID(string(job.EngagementID))
		if err != nil {
			return err
		}
		keys = append(keys, dbvalue.JobKey(id, int32(job.Opening.Number)))
	}
	rows, err := s.Queries.ListJobOwners(ctx, sqlc.ListJobOwnersParams{
		OrgDid: orgDID, Jobs: keys,
	})
	if err != nil {
		return err
	}
	owners := make(map[string]sqlc.ListJobOwnersRow, len(rows))
	for _, row := range rows {
		owners[dbvalue.JobKey(row.EngagementID, row.OpeningNumber)] = row
	}
	for index := range jobs {
		version := work.JobOwnerVersion(0)
		jobs[index].Owner = nil
		if row, ok := owners[keys[index]]; ok {
			version = work.JobOwnerVersion(row.Version)
			if row.OwnerEmail != "" {
				owner := common.EmailAddress(row.OwnerEmail)
				jobs[index].Owner = &owner
			}
		}
		jobs[index].OwnerVersion = &version
	}
	return nil
}

// SetJobOwner sets or clears the agency user who looks after a Job of an
// active `sourcing` engagement (MKT-OWN-002, MKT-OWN-003). It reads only this
// tenant: an Opening the client no longer assigns keeps an inert owner row.
func SetJobOwner(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request work.SetJobOwnerRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		engagementID, err := dbvalue.ParseUUID(string(request.EngagementID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse engagement id", err)
			return
		}
		now := s.CurrentTime()
		type result = handlerauth.Result[work.JobOwnership]
		fail := func(details problem.Body) (result, *handlerauth.Problem, error) {
			return handlerauth.Failure[work.JobOwnership](details)
		}
		handlerauth.RunIdempotent(s, w, r, "orgs:set-job-owner",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(ownerReplayWindow),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				if _, err := q.GetActiveSourcingEngagement(ctx, sqlc.GetActiveSourcingEngagementParams{
					EngagementID: engagementID, OrgDid: identity.OrgDID,
				}); errors.Is(err, pgx.ErrNoRows) {
					return fail(orgsproblem.EngagementWorkNotFoundError)
				} else if err != nil {
					return result{}, nil, err
				}
				var owner pgtype.UUID
				if request.OwnerEmail != nil {
					owner, err = q.LockOrgUserByEmail(ctx, sqlc.LockOrgUserByEmailParams{
						OrgDid: identity.OrgDID, EmailAddress: string(*request.OwnerEmail),
					})
					if errors.Is(err, pgx.ErrNoRows) {
						return fail(orgsproblem.JobOwnerInvalidError)
					}
					if err != nil {
						return result{}, nil, fmt.Errorf("lock owner: %w", err)
					}
					candidate, err := q.GetJobOwnerCandidate(ctx, sqlc.GetJobOwnerCandidateParams{
						EngagementID: engagementID, OpeningNumber: int32(request.OpeningNumber),
						OrgUserID: owner,
					})
					if err != nil {
						return result{}, nil, err
					}
					if !candidate.Eligible {
						return fail(orgsproblem.JobOwnerInvalidError)
					}
					if candidate.Owned >= work.MaxJobsPerOwner {
						return fail(orgsproblem.JobOwnerLimitReachedError)
					}
				}
				row, err := q.SetOrgJobOwner(ctx, sqlc.SetOrgJobOwnerParams{
					EngagementID: engagementID, OpeningNumber: int32(request.OpeningNumber),
					OrgDid: identity.OrgDID, OwnerOrgUserID: owner,
					ExpectedVersion: int32(request.OwnerVersion), TenantID: s.TenantID,
					ActorID: identity.UserID, IdempotencyKey: dbvalue.Text(string(key)),
				})
				if errors.Is(err, pgx.ErrNoRows) {
					return fail(orgsproblem.JobOwnerVersionConflictError)
				}
				if err != nil {
					return result{}, nil, err
				}
				if row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete Job owner write")
				}
				return result{Status: http.StatusOK, Body: work.JobOwnership{
					Owner: request.OwnerEmail, OwnerVersion: work.JobOwnerVersion(row.Version),
				}}, nil, nil
			})
	}
}

// SuggestJobOwners answers an autocomplete of the agency users who may own a
// Job.
func SuggestJobOwners(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request work.SuggestJobOwnersRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		params := sqlc.SuggestJobOwnersParams{
			OrgDid: identity.OrgDID, RowLimit: request.EffectiveLimit(),
		}
		if request.Query != nil {
			params.Query = dbvalue.Text(string(*request.Query))
		}
		rows, err := s.Queries.SuggestJobOwners(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "suggest Job owners", err)
			return
		}
		response := work.SuggestJobOwnersResponse{
			Owners: make([]common.EmailAddress, 0, len(rows)),
		}
		for _, email := range rows {
			response.Owners = append(response.Owners, common.EmailAddress(email))
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// SuggestClients answers an autocomplete of the Org's clients, from the
// engagement projections this tenant keeps.
func SuggestClients(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request work.SuggestClientsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		params := sqlc.SuggestProviderClientsParams{
			OrgDid: identity.OrgDID, RowLimit: request.EffectiveLimit(),
		}
		if request.Capability != nil {
			params.Capability = dbvalue.Text(string(*request.Capability))
		}
		if request.Query != nil {
			params.Query = dbvalue.Text(string(*request.Query))
		}
		rows, err := s.Queries.SuggestProviderClients(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "suggest clients", err)
			return
		}
		response := work.SuggestClientsResponse{
			Clients: make([]marketplace.EngagementCounterparty, 0, len(rows)),
		}
		for _, row := range rows {
			response.Clients = append(response.Clients, marketplace.EngagementCounterparty{
				Domain: orgs.OrgDomain(row.ConsumerDomain), DisplayName: row.ConsumerDisplayName,
			})
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
