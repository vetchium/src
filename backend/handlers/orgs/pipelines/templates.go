package pipelines

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const templatesPaginationPurpose = "orgs-list-pipeline-templates-v1"

type templatesCursor struct {
	AfterName string `json:"after_name"`
	AfterID   string `json:"after_id"`
}

func stagesJSON(stages []hiring.PipelineStageDefinition) ([]byte, error) {
	return json.Marshal(stages)
}

func templateFrom(
	id pgtype.UUID, name string, created, updated pgtype.Timestamptz,
	stages []byte,
) (hiring.PipelineTemplate, error) {
	template := hiring.PipelineTemplate{
		ID:        hiring.PipelineTemplateID(dbvalue.FormatUUID(id)),
		Name:      hiring.PipelineName(name),
		CreatedAt: created.Time.UTC(),
		UpdatedAt: updated.Time.UTC(),
	}
	if err := json.Unmarshal(stages, &template.Stages); err != nil {
		return hiring.PipelineTemplate{}, fmt.Errorf("decode pipeline template stages: %w", err)
	}
	return template, nil
}

func loadTemplate(
	r *http.Request, q sqlc.Querier, identity middleware.OrgIdentity,
	id pgtype.UUID,
) (hiring.PipelineTemplate, error) {
	row, err := q.GetOrgPipelineTemplate(r.Context(), sqlc.GetOrgPipelineTemplateParams{
		OrgDid: identity.OrgDID, TemplateID: id,
	})
	if err != nil {
		return hiring.PipelineTemplate{}, err
	}
	return templateFrom(
		row.OrgPipelineTemplateID, row.Name, row.CreatedAt, row.UpdatedAt, row.Stages,
	)
}

func ListPipelineTemplates(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hiring.ListPipelineTemplatesRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		limit := int(request.EffectiveLimit())
		params := sqlc.ListOrgPipelineTemplatesParams{
			OrgDid: identity.OrgDID, PageLimit: int32(limit) + 1,
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), templatesPaginationPurpose,
				string(*request.PaginationKey),
			)
			var cursor templatesCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			id, err := dbvalue.ParseUUID(cursor.AfterID)
			if err != nil {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterName = dbvalue.Text(cursor.AfterName)
			params.AfterID = id
		}
		rows, err := s.Queries.ListOrgPipelineTemplates(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list pipeline templates", err)
			return
		}
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := hiring.ListPipelineTemplatesResponse{
			Templates: make([]hiring.PipelineTemplate, 0, len(rows)),
		}
		for _, row := range rows {
			template, err := templateFrom(
				row.OrgPipelineTemplateID, row.Name, row.CreatedAt, row.UpdatedAt, row.Stages,
			)
			if err != nil {
				s.InternalError(r.Context(), w, "decode pipeline template", err)
				return
			}
			response.Templates = append(response.Templates, template)
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(templatesCursor{
				AfterName: last.SortName,
				AfterID:   dbvalue.FormatUUID(last.OrgPipelineTemplateID),
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode pipeline template cursor", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), templatesPaginationPurpose, payload))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func CreatePipelineTemplate(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hiring.CreatePipelineTemplateRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[hiring.PipelineTemplate]
		handlerauth.RunIdempotent(s, w, r, "orgs:create-pipeline-template",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				if _, err := q.LockOrgForPipelineTemplates(r.Context(), identity.OrgDID); errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[hiring.PipelineTemplate](orgsproblem.OrgSuspendedError)
				} else if err != nil {
					return result{}, nil, err
				}
				id, err := dbvalue.NewUUIDv7(now)
				if err != nil {
					return result{}, nil, err
				}
				stages, err := stagesJSON(request.Stages)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.CreateOrgPipelineTemplate(r.Context(), sqlc.CreateOrgPipelineTemplateParams{
					OrgDid: identity.OrgDID, Name: string(request.Name), TemplateID: id,
					TemplateLimit: hiring.MaxPipelineTemplates, Stages: stages,
					TenantID: s.TenantID, ActorID: dbvalue.FormatUUID(identity.UserID),
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.NameTaken {
					return handlerauth.Failure[hiring.PipelineTemplate](orgsproblem.PipelineTemplateNameTakenError)
				}
				if row.CreatedRows == 0 {
					return handlerauth.Failure[hiring.PipelineTemplate](
						orgsproblem.PipelineTemplateLimitReachedError(hiring.MaxPipelineTemplates))
				}
				if row.CreatedRows != 1 || row.StageRows != int64(len(request.Stages)) || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete pipeline template creation")
				}
				created, err := loadTemplate(r, q, identity, id)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusCreated, Body: created}, nil, nil
			})
	}
}

func UpdatePipelineTemplate(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hiring.UpdatePipelineTemplateRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[hiring.PipelineTemplate]
		handlerauth.RunIdempotent(s, w, r, "orgs:update-pipeline-template",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				id, err := dbvalue.ParseUUID(string(request.TemplateID))
				if err != nil {
					return result{}, nil, err
				}
				if _, err := q.LockOrgForPipelineTemplates(r.Context(), identity.OrgDID); errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[hiring.PipelineTemplate](orgsproblem.OrgSuspendedError)
				} else if err != nil {
					return result{}, nil, err
				}
				stages, err := stagesJSON(request.Stages)
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.UpdateOrgPipelineTemplate(r.Context(), sqlc.UpdateOrgPipelineTemplateParams{
					OrgDid: identity.OrgDID, TemplateID: id, Name: string(request.Name),
					Stages: stages, TenantID: s.TenantID,
					ActorID:        dbvalue.FormatUUID(identity.UserID),
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if !row.Found {
					return handlerauth.Failure[hiring.PipelineTemplate](orgsproblem.PipelineTemplateNotFoundError)
				}
				if row.NameTaken {
					return handlerauth.Failure[hiring.PipelineTemplate](orgsproblem.PipelineTemplateNameTakenError)
				}
				if row.UpdatedRows != 1 || row.StageRows != int64(len(request.Stages)) || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete pipeline template update")
				}
				updated, err := loadTemplate(r, q, identity, id)
				if err != nil {
					return result{}, nil, err
				}
				return result{Status: http.StatusOK, Body: updated}, nil, nil
			})
	}
}

func DeletePipelineTemplate(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hiring.DeletePipelineTemplateRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type result = handlerauth.Result[struct{}]
		handlerauth.RunIdempotent(s, w, r, "orgs:delete-pipeline-template",
			dbvalue.FormatUUID(identity.UserID), key, request, now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				id, err := dbvalue.ParseUUID(string(request.TemplateID))
				if err != nil {
					return result{}, nil, err
				}
				row, err := q.DeleteOrgPipelineTemplate(r.Context(), sqlc.DeleteOrgPipelineTemplateParams{
					OrgDid: identity.OrgDID, TemplateID: id, TenantID: s.TenantID,
					ActorID:        dbvalue.FormatUUID(identity.UserID),
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if row.DeletedRows == 0 {
					return handlerauth.Failure[struct{}](orgsproblem.PipelineTemplateNotFoundError)
				}
				if row.DeletedRows != 1 || row.AuditRows != 1 {
					return result{}, nil, fmt.Errorf("incomplete pipeline template deletion")
				}
				return result{Status: http.StatusNoContent}, nil, nil
			})
	}
}
