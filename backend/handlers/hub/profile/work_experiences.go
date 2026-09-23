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

func SaveWorkExperience(s *hubruntime.Server) http.HandlerFunc {
	return mutationHandler(
		s, "hub:profile:save-work-experience",
		func() *profilespec.SaveWorkExperienceRequest {
			return &profilespec.SaveWorkExperienceRequest{}
		}, saveWorkExperience,
	)
}

func saveWorkExperience(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request *profilespec.SaveWorkExperienceRequest,
) (*handlerauth.Problem, error) {
	start := profileMonth(request.StartMonth)
	end := optionalProfileMonth(request.EndMonth)
	location := optionalProfileText(request.Location)
	description := optionalProfileText(request.Description)
	if request.ID != nil {
		id, err := dbvalue.ParseUUID(string(*request.ID))
		if err != nil {
			return nil, err
		}
		_, err = q.UpdateHubWorkExperience(
			ctx, sqlc.UpdateHubWorkExperienceParams{
				HubUserDid: did, WorkExperienceID: id,
				EmployerDomain: string(request.EmployerDomain),
				JobTitle:       string(request.JobTitle),
				StartMonth:     start, EndMonth: end,
				Location: location, Description: description,
				TenantID:       tenantID,
				IdempotencyKey: dbvalue.Text(string(key)),
			},
		)
		return conflictOnNoRows(err)
	}
	id, err := dbvalue.NewUUID()
	if err != nil {
		return nil, err
	}
	_, err = q.CreateHubWorkExperience(
		ctx, sqlc.CreateHubWorkExperienceParams{
			HubUserDid: did, WorkExperienceID: id,
			EmployerDomain: string(request.EmployerDomain),
			JobTitle:       string(request.JobTitle),
			StartMonth:     start, EndMonth: end,
			Location: location, Description: description,
			TenantID:       tenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		},
	)
	return conflictOnNoRows(err)
}

func DeleteWorkExperience(s *hubruntime.Server) http.HandlerFunc {
	return mutationHandler(
		s, "hub:profile:delete-work-experience",
		func() *profilespec.DeleteProfileEntryRequest {
			return &profilespec.DeleteProfileEntryRequest{}
		}, deleteWorkExperience,
	)
}

func deleteWorkExperience(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request *profilespec.DeleteProfileEntryRequest,
) (*handlerauth.Problem, error) {
	id, err := dbvalue.ParseUUID(string(request.ID))
	if err != nil {
		return nil, err
	}
	_, err = q.DeleteHubWorkExperience(
		ctx, sqlc.DeleteHubWorkExperienceParams{
			HubUserDid: did, WorkExperienceID: id,
			TenantID:       tenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		},
	)
	return conflictOnNoRows(err)
}
