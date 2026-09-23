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

func SaveEducation(s *hubruntime.Server) http.HandlerFunc {
	return mutationHandler(
		s, "hub:profile:save-education",
		func() *profilespec.SaveEducationalQualificationRequest {
			return &profilespec.SaveEducationalQualificationRequest{}
		}, saveEducation,
	)
}

func saveEducation(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request *profilespec.SaveEducationalQualificationRequest,
) (*handlerauth.Problem, error) {
	title := optionalProfileText(request.Title)
	supportingText := optionalProfileText(request.SupportingText)
	start := optionalProfileMonth(request.StartMonth)
	end := optionalProfileMonth(request.EndMonth)
	if request.ID != nil {
		id, err := dbvalue.ParseUUID(string(*request.ID))
		if err != nil {
			return nil, err
		}
		_, err = q.UpdateHubEducationalQualification(
			ctx, sqlc.UpdateHubEducationalQualificationParams{
				HubUserDid: did, EducationalQualificationID: id,
				InstitutionDomain: string(request.InstitutionDomain),
				Degree:            string(request.Degree),
				Title:             title, SupportingText: supportingText,
				StartMonth: start, EndMonth: end,
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
	_, err = q.CreateHubEducationalQualification(
		ctx, sqlc.CreateHubEducationalQualificationParams{
			HubUserDid: did, EducationalQualificationID: id,
			InstitutionDomain: string(request.InstitutionDomain),
			Degree:            string(request.Degree),
			Title:             title, SupportingText: supportingText,
			StartMonth: start, EndMonth: end,
			TenantID:       tenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		},
	)
	return conflictOnNoRows(err)
}

func DeleteEducation(s *hubruntime.Server) http.HandlerFunc {
	return mutationHandler(
		s, "hub:profile:delete-education",
		func() *profilespec.DeleteProfileEntryRequest {
			return &profilespec.DeleteProfileEntryRequest{}
		}, deleteEducation,
	)
}

func deleteEducation(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request *profilespec.DeleteProfileEntryRequest,
) (*handlerauth.Problem, error) {
	id, err := dbvalue.ParseUUID(string(request.ID))
	if err != nil {
		return nil, err
	}
	_, err = q.DeleteHubEducationalQualification(
		ctx, sqlc.DeleteHubEducationalQualificationParams{
			HubUserDid: did, EducationalQualificationID: id,
			TenantID:       tenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		},
	)
	return conflictOnNoRows(err)
}
