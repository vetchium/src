package engagements

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/engagements"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

func ListEngagements(s *orgsruntime.Server) http.HandlerFunc {
	return list(s, marketplace.ConsumerParty,
		func(r *http.Request, params sqlc.ListConsumerEngagementsParams) ([]engagements.Fields, error) {
			return s.Queries.ListConsumerEngagements(r.Context(), params)
		})
}

func GetEngagement(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.GetEngagementRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		id, err := dbvalue.ParseUUID(string(request.EngagementID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse engagement id", err)
			return
		}
		row, err := s.Queries.GetConsumerEngagement(r.Context(), sqlc.GetConsumerEngagementParams{
			EngagementID: id, OrgDid: identity.OrgDID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get engagement", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK,
			engagements.Snapshot(row).ViewFor(marketplace.ConsumerParty))
	}
}

// ProposeEngagement proposes an engagement on a provider's `listed` Listing.
// The provider's tenant is read first (MKT-DAT-002), before the transaction
// that records the proposal and reports it to the provider's tenant.
func ProposeEngagement(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.ProposeEngagementRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		ctx, cancel := contextWithDeadline(r, s)
		defer cancel()
		provider, details := s.ListingRead.Locate(ctx, request.ProviderDomain)
		if details != nil {
			s.Problem(r.Context(), w, unavailableAsNotAvailable(*details))
			return
		}
		if provider.OrgDID == identity.OrgDID {
			s.Problem(r.Context(), w, orgsproblem.EngagementSelfError)
			return
		}
		detail, details := s.ListingRead.Detail(ctx, provider.Tenant,
			marketplace.GetListingRequest{
				Domain: request.ProviderDomain, Capability: request.Capability,
			})
		if details != nil {
			s.Problem(r.Context(), w, unavailableAsNotAvailable(*details))
			return
		}
		now := s.CurrentTime()
		type result = handlerauth.Result[marketplace.Engagement]
		handlerauth.RunIdempotent(s, w, r, "orgs:propose-engagement",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				id, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.CreateOrgEngagement(r.Context(), sqlc.CreateOrgEngagementParams{
					EngagementID: id, ConsumerOrgDid: identity.OrgDID,
					ProviderOrgDid:      provider.OrgDID,
					ProviderDomain:      string(detail.Provider.Domain),
					ProviderDisplayName: detail.Provider.DisplayName,
					CapabilityOid:       string(request.Capability),
					Message:             dbvalue.NullText(request.Message),
					LifetimeDays:        int32(marketplace.ProposalLifetime / (24 * time.Hour)),
					TenantID:            s.TenantID,
					ActorID:             dbvalue.FormatUUID(identity.UserID),
					IdempotencyKey:      dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.CreatedRows == 0 {
					return handlerauth.Failure[marketplace.Engagement](orgsproblem.EngagementExistsError)
				}
				if row.CreatedRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete engagement proposal")
				}
				snapshot, err := engagements.EnqueueChange(r.Context(), q, id)
				if err != nil {
					return result{}, nil, err
				}
				return result{
					Status: http.StatusCreated,
					Body:   snapshot.ViewFor(marketplace.ConsumerParty),
				}, nil, nil
			})
	}
}

// unavailableAsNotAvailable answers a provider whose Listing cannot be read
// as one that cannot take engagements; an unreachable tenant stays so.
func unavailableAsNotAvailable(details problem.Details) problem.Details {
	if details.Type == orgsproblem.TenantUnavailableError.Type {
		return details
	}
	if details.Type == orgsproblem.ListingNotFoundError.Type {
		return orgsproblem.ListingNotAvailableError
	}
	return details
}

type consumerChange struct {
	operation  string
	action     string
	fromStates []string
	newState   sqlc.NullVetchiumOrgEngagementState
	ended      bool
}

// changeAsConsumer serves the consumer's own writes: each is one audited
// change of the engagement at the version the caller read, reported to the
// provider's tenant in the same transaction.
func changeAsConsumer[R any, PR interface {
	*R
	apiserver.Request
}](
	s *orgsruntime.Server, change consumerChange,
	target func(R) (marketplace.EngagementID, marketplace.EngagementVersion),
	fill func(R, *sqlc.ChangeOrgEngagementParams),
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request R
		if !apiserver.Decode(s, w, r, PR(&request)) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[marketplace.Engagement]
		handlerauth.RunIdempotent(s, w, r, change.operation,
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				engagementID, version := target(request)
				id, err := dbvalue.ParseUUID(string(engagementID))
				if err != nil {
					return result{}, nil, err
				}
				params := sqlc.ChangeOrgEngagementParams{
					EngagementID: id, ConsumerOrgDid: identity.OrgDID,
					Version: int32(version), FromStates: change.fromStates,
					NewState: change.newState, TenantID: s.TenantID,
					AuditAction: change.action, ActorType: "org_user",
					ActorID: dbvalue.FormatUUID(identity.UserID),
					Source:  "orgs-api", IdempotencyKey: dbvalue.Text(string(key)),
				}
				fill(request, &params)
				changed, err := q.ChangeOrgEngagement(r.Context(), params)
				if err != nil {
					return result{}, nil, err
				}
				if changed.ChangedRows == 0 {
					details, err := engagements.Refusal(r.Context(), q, id, identity.OrgDID, nil, params.Version)
					if err != nil {
						return result{}, nil, err
					}
					return handlerauth.Failure[marketplace.Engagement](details)
				}
				if changed.ChangedRows != 1 || changed.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete engagement change")
				}
				if change.ended {
					if err := engagements.EndAccess(r.Context(), q, id); err != nil {
						return result{}, nil, err
					}
				}
				snapshot, err := engagements.EnqueueChange(r.Context(), q, id)
				if err != nil {
					return result{}, nil, err
				}
				return result{
					Status: http.StatusOK,
					Body:   snapshot.ViewFor(marketplace.ConsumerParty),
				}, nil, nil
			})
	}
}

func WithdrawEngagement(s *orgsruntime.Server) http.HandlerFunc {
	return changeAsConsumer[marketplace.EngagementTarget](s, consumerChange{
		operation: "orgs:withdraw-engagement", action: "org.engagement.withdrawn",
		fromStates: []string{string(marketplace.ProposedEngagement)},
		newState: sqlc.NullVetchiumOrgEngagementState{
			VetchiumOrgEngagementState: sqlc.VetchiumOrgEngagementStateWithdrawn, Valid: true,
		},
	}, func(request marketplace.EngagementTarget) (marketplace.EngagementID, marketplace.EngagementVersion) {
		return request.EngagementID, request.Version
	}, func(marketplace.EngagementTarget, *sqlc.ChangeOrgEngagementParams) {})
}

func EndEngagement(s *orgsruntime.Server) http.HandlerFunc {
	return changeAsConsumer[marketplace.EndEngagementRequest](s, consumerChange{
		operation: "orgs:end-engagement", action: "org.engagement.ended",
		fromStates: []string{string(marketplace.ActiveEngagement)},
		newState: sqlc.NullVetchiumOrgEngagementState{
			VetchiumOrgEngagementState: sqlc.VetchiumOrgEngagementStateEnded, Valid: true,
		},
		ended: true,
	}, func(request marketplace.EndEngagementRequest) (marketplace.EngagementID, marketplace.EngagementVersion) {
		return request.EngagementID, request.Version
	}, func(request marketplace.EndEngagementRequest, params *sqlc.ChangeOrgEngagementParams) {
		params.EndedBy = sqlc.NullVetchiumOrgEngagementParty{
			VetchiumOrgEngagementParty: sqlc.VetchiumOrgEngagementPartyConsumer, Valid: true,
		}
		params.EndNote = dbvalue.NullText(request.Note)
	})
}

func SetEngagementReference(s *orgsruntime.Server) http.HandlerFunc {
	return changeAsConsumer[marketplace.SetEngagementReferenceRequest](s, consumerChange{
		operation: "orgs:set-engagement-reference", action: "org.engagement.reference_set",
		fromStates: engagements.AllStates(),
	}, func(request marketplace.SetEngagementReferenceRequest) (marketplace.EngagementID, marketplace.EngagementVersion) {
		return request.EngagementID, request.Version
	}, func(request marketplace.SetEngagementReferenceRequest, params *sqlc.ChangeOrgEngagementParams) {
		params.ReferenceParty = string(marketplace.ConsumerParty)
		params.Reference = dbvalue.NullText(request.Reference)
	})
}

func contextWithDeadline(
	r *http.Request, s *orgsruntime.Server,
) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), s.ListingDeadline)
}
