package pipelines

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

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

func openingPipeline(
	r *http.Request, q sqlc.Querier, identity middleware.OrgIdentity,
	number openings.OpeningNumber,
) (openings.OpeningPipeline, sqlc.VetchiumOrgOpeningState, error) {
	row, err := q.GetOrgOpeningPipeline(r.Context(), sqlc.GetOrgOpeningPipelineParams{
		OrgDid: identity.OrgDID, OpeningNumber: int32(number),
	})
	if err != nil {
		return openings.OpeningPipeline{}, "", err
	}
	pipeline := openings.OpeningPipeline{
		OpeningNumber: openings.OpeningNumber(row.OpeningNumber),
		Version:       openings.OpeningVersion(row.Version),
	}
	if err := json.Unmarshal(row.Stages, &pipeline.Stages); err != nil {
		return openings.OpeningPipeline{}, "", fmt.Errorf("decode Opening pipeline: %w", err)
	}
	return pipeline, row.OpeningState, nil
}

func GetOpeningPipeline(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.GetOpeningPipelineRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		pipeline, state, err := openingPipeline(r, s.Queries, identity, request.OpeningNumber)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.OpeningNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Opening pipeline", err)
			return
		}
		// A discarded Opening keeps only a tombstone, so it has no pipeline.
		if state == sqlc.VetchiumOrgOpeningStateDiscarded {
			s.Problem(r.Context(), w, orgsproblem.OpeningStateConflictError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, pipeline)
	}
}

type replacementStage struct {
	ID    string `json:"id"`
	IsNew bool   `json:"is_new"`
	Name  string `json:"name"`
	Kind  string `json:"kind"`
}

func ReplaceOpeningPipeline(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.ReplaceOpeningPipelineRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[openings.OpeningPipeline]
		handlerauth.RunIdempotent(s, w, r, "orgs:replace-opening-pipeline",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				stages := make([]replacementStage, len(request.Stages))
				for index, stage := range request.Stages {
					entry := replacementStage{
						Name: string(stage.Name), Kind: string(stage.Kind),
					}
					if stage.ID != nil {
						entry.ID = string(*stage.ID)
					} else {
						id, err := dbvalue.NewUUIDv7(now)
						if err != nil {
							return result{}, nil, err
						}
						entry.ID, entry.IsNew = dbvalue.FormatUUID(id), true
					}
					stages[index] = entry
				}
				encoded, err := json.Marshal(stages)
				if err != nil {
					return result{}, nil, err
				}
				historyID, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.ReplaceOrgOpeningPipeline(r.Context(), sqlc.ReplaceOrgOpeningPipelineParams{
					Stages: encoded, OrgDid: identity.OrgDID,
					OpeningNumber: int32(request.OpeningNumber), Version: int32(request.Version),
					HistoryID: historyID, ActorID: identity.UserID, TenantID: s.TenantID,
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.Version == 0 {
					return replaceFailure(r, q, identity, request, row.UnknownPositions)
				}
				if row.StageRows != int64(len(request.Stages)) || row.HistoryRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete Opening pipeline replacement")
				}
				pipeline, _, err := openingPipeline(r, q, identity, request.OpeningNumber)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: pipeline}, nil, nil
			})
	}
}

// replaceFailure picks the refusal after the guarded write changed nothing.
// Version and state outrank an unknown stage id: a stale caller names ids
// another edit has already removed.
func replaceFailure(
	r *http.Request, q *sqlc.Queries, identity middleware.OrgIdentity,
	request openings.ReplaceOpeningPipelineRequest, unknownPositions []byte,
) (handlerauth.Result[openings.OpeningPipeline], *handlerauth.Problem, error) {
	type result = handlerauth.Result[openings.OpeningPipeline]
	current, state, err := openingPipeline(r, q, identity, request.OpeningNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return handlerauth.Failure[openings.OpeningPipeline](orgsproblem.OpeningNotFoundError)
	}
	if err != nil {
		return result{}, nil, err
	}
	if current.Version != request.Version {
		return handlerauth.Failure[openings.OpeningPipeline](orgsproblem.OpeningVersionConflictError)
	}
	switch state {
	case sqlc.VetchiumOrgOpeningStateDraft, sqlc.VetchiumOrgOpeningStatePublished,
		sqlc.VetchiumOrgOpeningStatePaused:
	default:
		return handlerauth.Failure[openings.OpeningPipeline](orgsproblem.OpeningStateConflictError)
	}
	var positions []int
	if err := json.Unmarshal(unknownPositions, &positions); err != nil {
		return result{}, nil, fmt.Errorf("decode unknown stage positions: %w", err)
	}
	if len(positions) == 0 {
		return result{}, nil, errors.New("the Opening pipeline replacement changed nothing")
	}
	details := problem.ValidationFailedError
	details.Fields = make([]string, len(positions))
	for index, position := range positions {
		details.Fields[index] = fmt.Sprintf("stages.%d.id", position-1)
	}
	return handlerauth.Failure[openings.OpeningPipeline](details)
}
