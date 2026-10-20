package engagements

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

// terminalOpening reports an Opening no provider can be attached to: one
// discarded, closed, or expired. Drafts, published, and paused Openings take
// assignments (MKT-ASG-001).
func terminalOpening(state string) bool {
	switch openings.OpeningState(state) {
	case openings.Discarded, openings.Closed, openings.Expired:
		return true
	default:
		return false
	}
}

// readOpeningProviders lists what is assigned to the Opening and each of its
// stages, in pipeline order.
func readOpeningProviders(
	r *http.Request, q sqlc.Querier, openingID pgtype.UUID,
	number openings.OpeningNumber,
) (marketplace.OpeningProviders, error) {
	stages, err := q.ListOpeningStages(r.Context(), openingID)
	if err != nil {
		return marketplace.OpeningProviders{}, fmt.Errorf("list Opening stages: %w", err)
	}
	rows, err := q.ListOpeningAssignments(r.Context(), openingID)
	if err != nil {
		return marketplace.OpeningProviders{}, fmt.Errorf("list assignments: %w", err)
	}
	result := marketplace.OpeningProviders{
		OpeningNumber: number, Agencies: []marketplace.Assignment{},
		Stages: make([]marketplace.StageAssignments, len(stages)),
	}
	index := map[pgtype.UUID]int{}
	for position, stage := range stages {
		index[stage.OrgOpeningStageID] = position
		result.Stages[position] = marketplace.StageAssignments{
			Stage: hiring.PipelineStage{
				ID:   hiring.PipelineStageID(dbvalue.FormatUUID(stage.OrgOpeningStageID)),
				Name: hiring.PipelineName(stage.Name),
				Kind: hiring.StageKind(stage.StageKind),
			},
			Assignments: []marketplace.Assignment{},
		}
	}
	for _, row := range rows {
		assignment := marketplace.Assignment{
			EngagementID: marketplace.EngagementID(dbvalue.FormatUUID(row.EngagementID)),
			Counterparty: marketplace.EngagementCounterparty{
				Domain: orgs.OrgDomain(row.ProviderDomain), DisplayName: row.ProviderDisplayName,
			},
			Capability: marketplace.Capability(row.CapabilityOid),
			AssignedAt: row.AssignedAt.Time.UTC(),
		}
		if !row.OrgOpeningStageID.Valid {
			result.Agencies = append(result.Agencies, assignment)
			continue
		}
		position, ok := index[row.OrgOpeningStageID]
		if !ok {
			return marketplace.OpeningProviders{}, fmt.Errorf("assignment to a stage outside the Opening")
		}
		result.Stages[position].Assignments = append(result.Stages[position].Assignments, assignment)
	}
	return result, nil
}

func GetOpeningProviders(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.GetOpeningProvidersRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		opening, err := s.Queries.GetOrgOpeningForProviders(r.Context(), sqlc.GetOrgOpeningForProvidersParams{
			OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.OpeningNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read Opening", err)
			return
		}
		result, err := readOpeningProviders(r, s.Queries, opening.OrgOpeningID, request.OpeningNumber)
		if err != nil {
			s.InternalError(r.Context(), w, "read Opening providers", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

func AssignOpeningProvider(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.AssignOpeningProviderRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[marketplace.OpeningProviders]
		handlerauth.RunIdempotent(s, w, r, "orgs:assign-opening-provider",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				fail := func(details problem.Body) (result, *handlerauth.Problem, error) {
					return handlerauth.Failure[marketplace.OpeningProviders](details)
				}
				ctx := r.Context()
				opening, err := q.LockOrgOpeningForProviders(ctx, sqlc.LockOrgOpeningForProvidersParams{
					OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
				})
				if errors.Is(err, pgx.ErrNoRows) {
					return fail(orgsproblem.OpeningNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				if terminalOpening(opening.OpeningState) {
					return fail(orgsproblem.OpeningStateConflictError)
				}
				engagementID, err := dbvalue.ParseUUID(string(request.EngagementID))
				if err != nil {
					return result{}, nil, err
				}
				engagement, err := q.GetEngagementForAssignment(ctx, sqlc.GetEngagementForAssignmentParams{
					EngagementID: engagementID, OrgDid: identity.OrgDID,
				})
				if errors.Is(err, pgx.ErrNoRows) {
					return fail(orgsproblem.EngagementNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				if engagement.EngagementState != sqlc.VetchiumOrgEngagementStateActive {
					return fail(orgsproblem.EngagementStateConflictError)
				}
				var stageID pgtype.UUID
				limit := int32(marketplace.MaxOpeningAgencies)
				if request.StageID != nil {
					limit = marketplace.MaxStageProviders
					if stageID, err = dbvalue.ParseUUID(string(*request.StageID)); err != nil {
						return result{}, nil, err
					}
					kind, err := q.GetOpeningStageKind(ctx, sqlc.GetOpeningStageKindParams{
						StageID: stageID, OrgOpeningID: opening.OrgOpeningID,
					})
					if errors.Is(err, pgx.ErrNoRows) {
						return fail(invalidFields("stage_id"))
					}
					if err != nil {
						return result{}, nil, err
					}
					if engagement.PerformsStageKind == "" || engagement.PerformsStageKind != kind {
						return fail(orgsproblem.EngagementCapabilityMismatchError)
					}
				} else if marketplace.Capability(engagement.CapabilityOid) != marketplace.Sourcing {
					return fail(orgsproblem.EngagementCapabilityMismatchError)
				}
				assignmentID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.AssignOrgEngagement(ctx, sqlc.AssignOrgEngagementParams{
					OrgOpeningID: opening.OrgOpeningID, StageID: stageID,
					EngagementID: engagementID, AssignmentID: assignmentID,
					ActorID: identity.UserID, AssignmentLimit: limit,
					TenantID: s.TenantID, OrgDid: identity.OrgDID,
					IdempotencyKey: dbvalue.Text(string(key)),
					OpeningNumber:  int32(request.OpeningNumber),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.AlreadyAssigned {
					return fail(orgsproblem.AssignmentExistsError)
				}
				if row.AssignedRows == 0 {
					return fail(orgsproblem.AssignmentLimitReachedError(limit))
				}
				if row.AssignedRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete assignment")
				}
				providers, err := readOpeningProviders(r, q, opening.OrgOpeningID, request.OpeningNumber)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: providers}, nil, nil
			})
	}
}

func UnassignOpeningProvider(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.UnassignOpeningProviderRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[marketplace.OpeningProviders]
		handlerauth.RunIdempotent(s, w, r, "orgs:unassign-opening-provider",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				opening, err := q.LockOrgOpeningForProviders(ctx, sqlc.LockOrgOpeningForProvidersParams{
					OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
				})
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[marketplace.OpeningProviders](orgsproblem.OpeningNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				engagementID, err := dbvalue.ParseUUID(string(request.EngagementID))
				if err != nil {
					return result{}, nil, err
				}
				var stageID pgtype.UUID
				if request.StageID != nil {
					if stageID, err = dbvalue.ParseUUID(string(*request.StageID)); err != nil {
						return result{}, nil, err
					}
				}
				row, err := q.UnassignOrgEngagement(ctx, sqlc.UnassignOrgEngagementParams{
					OrgOpeningID: opening.OrgOpeningID, EngagementID: engagementID,
					StageID: stageID, TenantID: s.TenantID, ActorID: identity.UserID,
					OrgDid: identity.OrgDID, IdempotencyKey: dbvalue.Text(string(key)),
					OpeningNumber: int32(request.OpeningNumber),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.RemovedRows == 0 {
					return handlerauth.Failure[marketplace.OpeningProviders](orgsproblem.AssignmentNotFoundError)
				}
				if row.RemovedRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete unassignment")
				}
				providers, err := readOpeningProviders(r, q, opening.OrgOpeningID, request.OpeningNumber)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: providers}, nil, nil
			})
	}
}

func invalidFields(fields ...string) problem.Body {
	details := problem.ValidationFailedError
	details.Fields = fields
	return details
}
