package openings

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

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
)

func changeFailure(q *sqlc.Queries, r *http.Request, identity middleware.OrgIdentity, number openings.OpeningNumber, version openings.OpeningVersion, pendingContentOnly bool) (handlerauth.Result[openings.OrgOpening], *handlerauth.Problem, error) {
	state, err := q.GetOrgOpeningChangeState(r.Context(), sqlc.GetOrgOpeningChangeStateParams{
		OrgDid: identity.OrgDID, OpeningNumber: int32(number),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningNotFoundError)
	}
	if err != nil {
		return handlerauth.Result[openings.OrgOpening]{}, nil, err
	}
	if state.Version != int32(version) {
		return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningVersionConflictError)
	}
	if (!pendingContentOnly && state.HasPendingRequest) || (pendingContentOnly && state.HasPendingContentRequest) {
		return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningRequestPendingError)
	}
	return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningStateConflictError)
}

func fillOpeningContent(values, live common.OpeningContent) common.OpeningContent {
	if values.Title == nil {
		values.Title = live.Title
	}
	if values.Description == nil {
		values.Description = live.Description
	}
	if values.Language == nil {
		values.Language = live.Language
	}
	if values.EmployingCountry == nil {
		values.EmployingCountry = live.EmployingCountry
	}
	if values.WorkArrangement == nil {
		values.WorkArrangement = live.WorkArrangement
	}
	if values.LocationDetails == nil {
		values.LocationDetails = live.LocationDetails
	}
	if values.RemoteEligibility == nil {
		values.RemoteEligibility = live.RemoteEligibility
	}
	if values.EmploymentType == nil {
		values.EmploymentType = live.EmploymentType
	}
	if values.Positions == nil {
		values.Positions = live.Positions
	}
	if values.ExperienceYears == nil {
		values.ExperienceYears = live.ExperienceYears
	}
	if values.MinimumEducation == nil {
		values.MinimumEducation = live.MinimumEducation
	}
	if values.Salary == nil {
		values.Salary = live.Salary
	}
	return values
}

func SaveOpeningWorkingCopy(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.SaveOpeningWorkingCopyRequest
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
		handlerauth.RunIdempotent(s, w, r, "orgs:save-opening-working-copy",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				values := *request.Content
				current, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningNotFoundError)
				}
				if err != nil {
					return result{}, nil, err
				}
				if current.WorkingContent == nil && current.LiveContent != nil {
					values = fillOpeningContent(values, *current.LiveContent)
					if fields := values.Validate(); len(fields) > 0 {
						for index := range fields {
							fields[index] = "content." + fields[index]
						}
						details := problem.ValidationFailedError
						details.Fields = fields
						return handlerauth.Failure[openings.OrgOpening](details)
					}
				}
				content, err := json.Marshal(values)
				if err != nil {
					return result{}, nil, err
				}
				historyID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.SaveOrgOpeningWorkingCopy(r.Context(), sqlc.SaveOrgOpeningWorkingCopyParams{
					Content: content, OrgDid: identity.OrgDID,
					OpeningNumber: int32(request.OpeningNumber), Version: int32(request.Version),
					ActorID: identity.UserID, HistoryID: historyID, TenantID: s.TenantID,
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.Version == 0 {
					return changeFailure(q, r, identity, request.OpeningNumber, request.Version, true)
				}
				if row.SavedRows != 1 || row.HistoryRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete Opening working copy save")
				}
				updated, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: updated}, nil, nil
			})
	}
}

func DiscardOpeningWorkingCopy(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.DiscardOpeningWorkingCopyRequest
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
		handlerauth.RunIdempotent(s, w, r, "orgs:discard-opening-working-copy",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				historyID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.DiscardOrgOpeningWorkingCopy(r.Context(), sqlc.DiscardOrgOpeningWorkingCopyParams{
					OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
					Version: int32(request.Version), HistoryID: historyID,
					ActorID: identity.UserID, TenantID: s.TenantID,
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.Version == 0 {
					return changeFailure(q, r, identity, request.OpeningNumber, request.Version, true)
				}
				if row.RemovedRows != 1 || row.HistoryRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete Opening working copy discard")
				}
				updated, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: updated}, nil, nil
			})
	}
}

func DiscardOpening(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.DiscardOpeningRequest
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
		handlerauth.RunIdempotent(s, w, r, "orgs:discard-opening",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				historyID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.DiscardOrgOpening(r.Context(), sqlc.DiscardOrgOpeningParams{
					OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
					Version: int32(request.Version), HistoryID: historyID,
					ActorID: identity.UserID, TenantID: s.TenantID,
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.Version == 0 {
					return changeFailure(q, r, identity, request.OpeningNumber, request.Version, false)
				}
				if row.HistoryRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete Opening discard")
				}
				updated, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: updated}, nil, nil
			})
	}
}

func SetOpeningTeam(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.SetOpeningTeamRequest
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
		handlerauth.RunIdempotent(s, w, r, "orgs:set-opening-team",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				historyID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				team := make([]string, len(request.TeamMemberEmails))
				for index, email := range request.TeamMemberEmails {
					team[index] = string(email)
				}
				row, err := q.SetOrgOpeningTeam(r.Context(), sqlc.SetOrgOpeningTeamParams{
					OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
					Version: int32(request.Version), HiringManagerEmail: optionalEmail(request.HiringManagerEmail),
					RecruiterEmail: optionalEmail(request.RecruiterEmail), TeamMemberEmails: team,
					InternalNotes: dbvalue.NullText(request.InternalNotes),
					HistoryID:     historyID, ActorID: identity.UserID, TenantID: s.TenantID,
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				var invalid []string
				if err := json.Unmarshal(row.InvalidAddresses, &invalid); err != nil {
					return result{}, nil, fmt.Errorf("decode invalid hiring team: %w", err)
				}
				if len(invalid) > 0 {
					state, err := q.GetOrgOpeningChangeState(r.Context(), sqlc.GetOrgOpeningChangeStateParams{
						OrgDid: identity.OrgDID, OpeningNumber: int32(request.OpeningNumber),
					})
					if errors.Is(err, pgx.ErrNoRows) {
						return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningNotFoundError)
					}
					if err != nil {
						return result{}, nil, err
					}
					if state.Version != int32(request.Version) {
						return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningVersionConflictError)
					}
					if state.OpeningState != sqlc.VetchiumOrgOpeningStateDraft &&
						state.OpeningState != sqlc.VetchiumOrgOpeningStatePublished &&
						state.OpeningState != sqlc.VetchiumOrgOpeningStatePaused {
						return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningStateConflictError)
					}
					return handlerauth.Failure[openings.OrgOpening](orgsproblem.OpeningHiringTeamInvalidError(invalid))
				}
				if row.Version == 0 {
					return changeFailure(q, r, identity, request.OpeningNumber, request.Version, false)
				}
				if row.HistoryRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete Opening team change")
				}
				updated, err := loadOpening(r.Context(), q, identity, request.OpeningNumber)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: updated}, nil, nil
			})
	}
}
