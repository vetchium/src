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

func SaveCertification(s *hubruntime.Server) http.HandlerFunc {
	return mutationHandler(
		s, "hub:profile:save-certification",
		func() *profilespec.SaveCertificationRequest {
			return &profilespec.SaveCertificationRequest{}
		}, saveCertification,
	)
}

func saveCertification(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request *profilespec.SaveCertificationRequest,
) (*handlerauth.Problem, error) {
	if request.ID != nil {
		id, err := dbvalue.ParseUUID(string(*request.ID))
		if err != nil {
			return nil, err
		}
		_, err = q.UpdateHubCertification(
			ctx, sqlc.UpdateHubCertificationParams{
				HubUserDid: did, CertificationID: id,
				Title:          string(request.Title),
				CredentialUrl:  string(request.CredentialURL),
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
	_, err = q.CreateHubCertification(
		ctx, sqlc.CreateHubCertificationParams{
			HubUserDid: did, CertificationID: id,
			Title:          string(request.Title),
			CredentialUrl:  string(request.CredentialURL),
			TenantID:       tenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		},
	)
	return conflictOnNoRows(err)
}

func DeleteCertification(s *hubruntime.Server) http.HandlerFunc {
	return mutationHandler(
		s, "hub:profile:delete-certification",
		func() *profilespec.DeleteProfileEntryRequest {
			return &profilespec.DeleteProfileEntryRequest{}
		}, deleteCertification,
	)
}

func deleteCertification(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request *profilespec.DeleteProfileEntryRequest,
) (*handlerauth.Problem, error) {
	id, err := dbvalue.ParseUUID(string(request.ID))
	if err != nil {
		return nil, err
	}
	_, err = q.DeleteHubCertification(
		ctx, sqlc.DeleteHubCertificationParams{
			HubUserDid: did, CertificationID: id,
			TenantID:       tenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		},
	)
	return conflictOnNoRows(err)
}
