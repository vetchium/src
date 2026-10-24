package engagements

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	"backend/internal/providerwork"
)

// GetEngagementStatement reads one monthly activity statement as the consumer.
func GetEngagementStatement(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.GetActivityStatementRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		reader := providerwork.Reader{Queries: s.Queries}
		res, err := reader.ReadActivityStatement(
			r.Context(),
			string(request.EngagementID),
			identity.OrgDID,
			true,
			request.Month,
			request.PaginationKey,
			request.EffectiveLimit(),
		)
		if errors.Is(err, providerwork.ErrNotFound) {
			s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
			return
		}
		if errors.Is(err, providerwork.ErrInvalidCursor) {
			s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read engagement statement", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, res)
	}
}

// GetClientEngagementStatement reads one monthly activity statement as the provider, live from the consumer tenant.
func GetClientEngagementStatement(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.GetActivityStatementRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		id, err := dbvalue.ParseUUID(string(request.EngagementID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse engagement id", err)
			return
		}
		row, err := s.Queries.GetProviderEngagement(r.Context(), sqlc.GetProviderEngagementParams{
			EngagementID: id, OrgDid: identity.OrgDID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get provider engagement projection", err)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), s.ListingDeadline)
		defer cancel()
		tenant, details := s.ListingRead.HomeOf(ctx, row.ConsumerOrgDid)
		if details != nil {
			if details.Type == orgsproblem.ListingNotFoundError.Type {
				s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
				return
			}
			s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
			return
		}

		outcome, err := s.WorkRelay.RelayGetActivityStatement(ctx, work.RelayGetActivityStatementRequest{
			Tenant: tenant,
			Request: work.PeerGetActivityStatementRequest{
				ProviderOrgDID: orgs.OrgDID(dbvalue.FormatUUID(identity.OrgDID)),
				EngagementID:   request.EngagementID,
				Month:          request.Month,
				PaginationKey:  request.PaginationKey,
				Limit:          request.EffectiveLimit(),
			},
		})
		if err == nil && outcome.Problem != nil {
			if outcome.Problem.Type == orgsproblem.EngagementNotFoundError.Type {
				s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
				return
			}
			if outcome.Problem.Type == problem.InvalidPaginationKeyError.Type {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
		}
		if err != nil || outcome.Problem != nil || outcome.Result == nil {
			s.WarnContext(r.Context(), "client tenant did not answer statement read",
				"event", "statement_read_unavailable", "error", err)
			s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
			return
		}

		response := marketplace.GetActivityStatementResponse{
			EngagementID:      outcome.Result.EngagementID,
			Month:             outcome.Result.Month,
			Items:             outcome.Result.Items,
			NextPaginationKey: outcome.Result.NextPaginationKey,
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
