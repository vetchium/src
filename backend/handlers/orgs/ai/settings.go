package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	aispec "github.com/vetchium/src/typespec/orgs/ai"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
)

func GetAISettings(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.AI == nil {
			s.Problem(r.Context(), w, orgsproblem.AIUnavailableError)
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		state, err := s.Queries.GetOrgAIState(r.Context(), identity.OrgDID)
		if errors.Is(err, pgx.ErrNoRows) {
			s.AuthenticationProblem(
				r.Context(), w, orgsproblem.AuthenticationRequiredError,
				orgsauthn.BearerChallenge,
			)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get AI settings", err)
			return
		}
		rows, err := s.Queries.ListOrgAIPolicies(r.Context(), identity.OrgDID)
		if err != nil {
			s.InternalError(r.Context(), w, "list AI policies", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK,
			settingsResponse(s, state, rows, s.CurrentTime()))
	}
}

func SetAISettings(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request aispec.SetAISettingsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		now := s.CurrentTime()
		type body = aispec.AISettingsResponse
		type result = handlerauth.Result[body]
		handlerauth.RunIdempotent(s, w, r, "orgs:set-ai-settings",
			dbvalue.FormatUUID(identity.UserID), key, request,
			now.Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				if s.AI == nil {
					return handlerauth.Failure[body](orgsproblem.AIUnavailableError)
				}
				var notOffered []string
				for _, policy := range request.Policies {
					for _, model := range policy.AllowedModels {
						if _, offered := s.AI.OfferedModel(model, now); !offered &&
							!slices.Contains(notOffered, string(model)) {
							notOffered = append(notOffered, string(model))
						}
					}
				}
				if len(notOffered) > 0 {
					return handlerauth.Failure[body](
						orgsproblem.AIModelNotOfferedError(notOffered),
					)
				}
				if request.AcceptTermsVersion != nil &&
					*request.AcceptTermsVersion != aispec.OrgAITermsVersion {
					return handlerauth.Failure[body](
						orgsproblem.AITermsRequiredError(aispec.OrgAITermsVersion),
					)
				}
				state, err := q.GetOrgAIState(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, err
				}
				alreadyAccepted := state.AcceptedTermsVersion.Valid &&
					state.AcceptedTermsVersion.String == aispec.OrgAITermsVersion
				if request.Enabled && !alreadyAccepted &&
					request.AcceptTermsVersion == nil {
					return handlerauth.Failure[body](
						orgsproblem.AITermsRequiredError(aispec.OrgAITermsVersion),
					)
				}
				rows, err := q.ListOrgAIPolicies(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, err
				}
				accept := request.AcceptTermsVersion
				if alreadyAccepted {
					accept = nil
				}
				if accept == nil && state.Enabled == request.Enabled &&
					samePolicies(rows, request.Policies) {
					return result{
						Status: http.StatusOK,
						Body:   settingsResponse(s, state, rows, now),
					}, nil, nil
				}
				policies, err := json.Marshal(request.Policies)
				if err != nil {
					return result{}, nil, err
				}
				saved, err := q.SaveOrgAISettings(ctx, sqlc.SaveOrgAISettingsParams{
					Policies: policies, OrgDid: identity.OrgDID,
					Enabled:            request.Enabled,
					AcceptTermsVersion: dbvalue.NullText(accept),
					ActorOrgUserID:     identity.UserID, TenantID: s.TenantID,
					IdempotencyKey: dbvalue.Text(string(key)),
				})
				if err != nil {
					return result{}, nil, err
				}
				if saved.SavedCount != 1 || saved.AuditCount != 1 ||
					int(saved.UpsertedCount) != len(request.Policies) {
					return result{}, nil, fmt.Errorf("incomplete AI settings save")
				}
				state, err = q.GetOrgAIState(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, err
				}
				rows, err = q.ListOrgAIPolicies(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, err
				}
				return result{
					Status: http.StatusOK,
					Body:   settingsResponse(s, state, rows, now),
				}, nil, nil
			})
	}
}

// samePolicies compares stored and requested policies regardless of order;
// allowed models keep their order, which the portal presents.
func samePolicies(
	rows []sqlc.ListOrgAIPoliciesRow, requested []aispec.AIOperationPolicy,
) bool {
	if len(rows) != len(requested) {
		return false
	}
	for _, policy := range requested {
		index := slices.IndexFunc(rows, func(row sqlc.ListOrgAIPoliciesRow) bool {
			return row.Operation == string(policy.Operation)
		})
		if index < 0 {
			return false
		}
		stored := rows[index]
		if stored.DefaultModel.Valid != (policy.DefaultModel != nil) ||
			(policy.DefaultModel != nil &&
				stored.DefaultModel.String != string(*policy.DefaultModel)) ||
			!slices.EqualFunc(rows[index].AllowedModels, policy.AllowedModels,
				func(stored string, model aispec.AIModelOID) bool {
					return stored == string(model)
				}) {
			return false
		}
	}
	return true
}
