package profile

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	profilespec "github.com/vetchium/src/typespec/hub/profile"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
)

func AddLanguageAbility(s *hubruntime.Server) http.HandlerFunc {
	return mutationHandler(
		s, "hub:profile:add-language-ability",
		func() *profilespec.ChangeLanguageAbilityRequest {
			return &profilespec.ChangeLanguageAbilityRequest{}
		}, addLanguageAbility,
	)
}

func addLanguageAbility(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request *profilespec.ChangeLanguageAbilityRequest,
) (*handlerauth.Problem, error) {
	_, err := q.AddHubLanguageAbility(
		ctx, sqlc.AddHubLanguageAbilityParams{
			HubUserDid:     did,
			Ability:        sqlc.VetchiumHubLanguageAbilityKind(request.Ability),
			LanguageTag:    string(request.LanguageTag),
			TenantID:       tenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		},
	)
	return conflictOnNoRows(err)
}

func DeleteLanguageAbility(s *hubruntime.Server) http.HandlerFunc {
	return mutationHandler(
		s, "hub:profile:delete-language-ability",
		func() *profilespec.ChangeLanguageAbilityRequest {
			return &profilespec.ChangeLanguageAbilityRequest{}
		}, deleteLanguageAbility,
	)
}

func deleteLanguageAbility(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request *profilespec.ChangeLanguageAbilityRequest,
) (*handlerauth.Problem, error) {
	_, err := q.DeleteHubLanguageAbility(
		ctx, sqlc.DeleteHubLanguageAbilityParams{
			HubUserDid:     did,
			Ability:        sqlc.VetchiumHubLanguageAbilityKind(request.Ability),
			LanguageTag:    string(request.LanguageTag),
			TenantID:       tenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		},
	)
	return conflictOnNoRows(err)
}
