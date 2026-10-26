package openings

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/openings"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	"backend/internal/orgs/applicationchanges"
)

func requestPrecondition(current openings.OrgOpening, request openings.RequestOpeningChangeRequest, canApprove bool) problem.Body {
	if current.Version != request.Version {
		return orgsproblem.OpeningVersionConflictError
	}
	if current.PendingRequest != nil && (!canApprove || request.Kind != openings.CloseRequest) {
		return orgsproblem.OpeningRequestPendingError
	}
	switch request.Kind {
	case openings.PublishRequest:
		if current.State != openings.Draft {
			return orgsproblem.OpeningStateConflictError
		}
	case openings.ReviseRequest:
		if (current.State != openings.Published && current.State != openings.Paused) || current.WorkingContent == nil {
			return orgsproblem.OpeningStateConflictError
		}
	case openings.PauseRequest:
		if current.State != openings.Published {
			return orgsproblem.OpeningStateConflictError
		}
	case openings.ReopenRequest:
		if current.State != openings.Paused {
			return orgsproblem.OpeningStateConflictError
		}
	case openings.CloseRequest:
		if current.State != openings.Published && current.State != openings.Paused {
			return orgsproblem.OpeningStateConflictError
		}
	}
	if request.Kind == openings.PublishRequest || request.Kind == openings.ReviseRequest {
		fields := []string{}
		if current.WorkingContent != nil {
			for _, field := range common.MissingForPublication(*current.WorkingContent) {
				fields = append(fields, "content."+field)
			}
		}
		if current.HiringManager == nil {
			fields = append(fields, "hiring_manager_email")
		}
		if current.Recruiter == nil {
			fields = append(fields, "recruiter_email")
		}
		if len(fields) > 0 {
			return orgsproblem.OpeningIncompleteError(fields)
		}
		invalid := []string{}
		if !current.HiringManager.Active {
			invalid = append(invalid, string(current.HiringManager.Email))
		}
		if !current.Recruiter.Active && current.Recruiter.Email != current.HiringManager.Email {
			invalid = append(invalid, string(current.Recruiter.Email))
		}
		if len(invalid) > 0 {
			return orgsproblem.OpeningHiringTeamInvalidError(invalid)
		}
	}
	return nil
}

// markApplicationsNotProgressing applies a close request's bulk choice in the
// transaction that closed the Opening (HP-APP-005). The statement itself
// checks that the request that closed it asked for the choice.
func markApplicationsNotProgressing(
	ctx context.Context, q *sqlc.Queries, s *orgsruntime.Server,
	identity middleware.OrgIdentity, opening openings.OpeningNumber,
	key common.IdempotencyKey,
) error {
	_, err := applicationchanges.MarkClosedOpeningNotProgressing(ctx, q,
		identity.OrgDID, int32(opening), applicationchanges.Change{
			ActorID: identity.UserID, TenantID: s.TenantID,
			IdempotencyKey: string(key),
		})
	return err
}

func RequestOpeningChange(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.RequestOpeningChangeRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[openings.OrgOpening]
		handlerauth.RunIdempotent(s, w, r, "orgs:request-opening-change",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				current, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				// The SQL statement repeats authorization and state guards before any write.
				canApprove, err := q.OrgUserCanApproveOpening(r.Context(), identity.UserID)
				if err != nil {
					return result{}, nil, err
				}
				if details := requestPrecondition(current, request, canApprove); details != nil {
					return handlerauth.Failure[openings.OrgOpening](details)
				}
				requestID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				historyID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				supersededHistoryID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.RequestOrgOpeningChange(r.Context(), sqlc.RequestOrgOpeningChangeParams{
					ActorID: identity.UserID, Kind: string(request.Kind), OrgDid: identity.OrgDID,
					OpeningNumber: int32(request.OpeningNumber), Version: int32(request.Version),
					RequestID: requestID, Note: dbvalue.NullText(request.Note),
					HistoryID: historyID, SupersededHistoryID: supersededHistoryID,
					TenantID: s.TenantID, IdempotencyKey: dbvalue.Text(string(key)),
					MarkApplications: pgtype.Bool{
						Bool:  request.MarkApplicationsNotProgressing != nil && *request.MarkApplicationsNotProgressing,
						Valid: request.MarkApplicationsNotProgressing != nil,
					},
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.Version == 0 {
					fresh, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
					if errors.Is(err, pgx.ErrNoRows) {
						return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningNotFoundError)
					}
					if err != nil {
						return result{}, nil, err
					}
					if details := requestPrecondition(fresh, request, canApprove); details != nil {
						return handlerauth.Failure[openings.OrgOpening](details)
					}
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.PermissionRequiredError)
				}
				if row.RequestRows != 1 || row.HistoryRows != 1 || row.AuditRows != 1 ||
					row.SupersededRows != row.SupersededHistoryRows || row.SupersededRows != row.SupersededAuditRows {
					return result{}, nil, fmt.Errorf("incomplete Opening request transition")
				}
				if row.SelfApproved && request.Kind == openings.CloseRequest {
					if err := markApplicationsNotProgressing(r.Context(), q, s, identity, request.OpeningNumber, key); err != nil {
						return result{}, nil, err
					}
				}
				updated, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: updated}, nil, nil
			})
	}
}

func decisionPrecondition(current openings.OrgOpening, request openings.DecideOpeningRequestRequest) problem.Body {
	if current.Version != request.Version {
		return orgsproblem.OpeningVersionConflictError
	}
	if current.PendingRequest == nil {
		return orgsproblem.OpeningStateConflictError
	}
	kind := current.PendingRequest.Kind
	valid := false
	switch kind {
	case openings.PublishRequest:
		valid = current.State == openings.Draft
	case openings.ReviseRequest:
		valid = (current.State == openings.Published || current.State == openings.Paused) && current.WorkingContent != nil
	case openings.PauseRequest:
		valid = current.State == openings.Published
	case openings.ReopenRequest:
		valid = current.State == openings.Paused
	case openings.CloseRequest:
		valid = current.State == openings.Published || current.State == openings.Paused
	}
	if !valid {
		return orgsproblem.OpeningStateConflictError
	}
	if request.Decision == openings.ApproveDecision && (kind == openings.PublishRequest || kind == openings.ReviseRequest) {
		fields := []string{}
		if current.WorkingContent != nil {
			for _, field := range common.MissingForPublication(*current.WorkingContent) {
				fields = append(fields, "content."+field)
			}
		}
		if current.HiringManager == nil {
			fields = append(fields, "hiring_manager_email")
		}
		if current.Recruiter == nil {
			fields = append(fields, "recruiter_email")
		}
		if len(fields) > 0 {
			return orgsproblem.OpeningIncompleteError(fields)
		}
		invalid := []string{}
		if !current.HiringManager.Active {
			invalid = append(invalid, string(current.HiringManager.Email))
		}
		if !current.Recruiter.Active && current.Recruiter.Email != current.HiringManager.Email {
			invalid = append(invalid, string(current.Recruiter.Email))
		}
		if len(invalid) > 0 {
			return orgsproblem.OpeningHiringTeamInvalidError(invalid)
		}
	}
	return nil
}

func DecideOpeningRequest(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.DecideOpeningRequestRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[openings.OrgOpening]
		handlerauth.RunIdempotent(s, w, r, "orgs:decide-opening-request",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				current, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				if details := decisionPrecondition(current, request); details != nil {
					return handlerauth.Failure[openings.OrgOpening](details)
				}
				historyID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.DecideOrgOpeningRequest(r.Context(), sqlc.DecideOrgOpeningRequestParams{
					OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
					Decision: string(request.Decision), Version: int32(request.Version),
					ActorID: identity.UserID, Note: dbvalue.NullText(request.Note),
					HistoryID: historyID, TenantID: s.TenantID,
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.Version == 0 {
					fresh, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
					if errors.Is(err, pgx.ErrNoRows) {
						return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningNotFoundError)
					}
					if err != nil {
						return result{}, nil, err
					}
					if details := decisionPrecondition(fresh, request); details != nil {
						return handlerauth.Failure[openings.OrgOpening](details)
					}
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.PermissionRequiredError)
				}
				if row.DecisionRows != 1 || row.HistoryRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete Opening decision")
				}
				if request.Decision == openings.ApproveDecision &&
					current.PendingRequest.Kind == openings.CloseRequest {
					if err := markApplicationsNotProgressing(r.Context(), q, s, identity, request.OpeningNumber, key); err != nil {
						return result{}, nil, err
					}
				}
				updated, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: updated}, nil, nil
			})
	}
}

func WithdrawOpeningRequest(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.WithdrawOpeningRequestRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[openings.OrgOpening]
		handlerauth.RunIdempotent(s, w, r, "orgs:withdraw-opening-request",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				current, err := loadOpeningWithRequester(r.Context(), q, identity, request.OpeningNumber, true)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				if current.Version != request.Version {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningVersionConflictError)
				}
				if current.PendingRequest == nil {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningStateConflictError)
				}
				historyID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.WithdrawOrgOpeningRequest(r.Context(), sqlc.WithdrawOrgOpeningRequestParams{
					OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
					Version: int32(request.Version), ActorID: identity.UserID,
					HistoryID: historyID, TenantID: s.TenantID,
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.Version == 0 {
					fresh, err := loadOpeningWithRequester(r.Context(), q, identity, request.OpeningNumber, true)
					if errors.Is(err, pgx.ErrNoRows) {
						return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningNotFoundError)
					}
					if err != nil {
						return result{}, nil, err
					}
					if fresh.Version != request.Version {
						return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningVersionConflictError)
					}
					if fresh.PendingRequest == nil {
						return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningStateConflictError)
					}
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.PermissionRequiredError)
				}
				if row.WithdrawnRows != 1 || row.HistoryRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete Opening withdrawal")
				}
				updated, err := loadOpeningWithRequester(r.Context(), q, identity, request.OpeningNumber, true)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: updated}, nil, nil
			})
	}
}
