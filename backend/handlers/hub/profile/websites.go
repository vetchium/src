package profile

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
)

func SaveWebsite(s *hubruntime.Server) http.HandlerFunc {
	return mutationHandler(
		s, "hub:profile:save-website",
		func() *profilespec.SaveWebsiteRequest {
			return &profilespec.SaveWebsiteRequest{}
		}, saveWebsite,
	)
}

func saveWebsite(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request *profilespec.SaveWebsiteRequest,
) (*handlerauth.Problem, error) {
	if request.ID != nil {
		id, err := dbvalue.ParseUUID(string(*request.ID))
		if err != nil {
			return nil, err
		}
		_, err = q.UpdateHubWebsite(ctx, sqlc.UpdateHubWebsiteParams{
			HubUserDid: did, WebsiteID: id,
			WebsiteUrl:     string(request.URL),
			TenantID:       tenantID,
			IdempotencyKey: dbvalue.Text(string(key)),
		})
		return websiteConflict(err)
	}
	id, err := dbvalue.NewUUID()
	if err != nil {
		return nil, err
	}
	_, err = q.CreateHubWebsite(ctx, sqlc.CreateHubWebsiteParams{
		HubUserDid: did, WebsiteID: id,
		WebsiteUrl:     string(request.URL),
		TenantID:       tenantID,
		IdempotencyKey: dbvalue.Text(string(key)),
	})
	return websiteConflict(err)
}

func DeleteWebsite(s *hubruntime.Server) http.HandlerFunc {
	return mutationHandler(
		s, "hub:profile:delete-website",
		func() *profilespec.DeleteProfileEntryRequest {
			return &profilespec.DeleteProfileEntryRequest{}
		}, deleteWebsite,
	)
}

func deleteWebsite(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request *profilespec.DeleteProfileEntryRequest,
) (*handlerauth.Problem, error) {
	id, err := dbvalue.ParseUUID(string(request.ID))
	if err != nil {
		return nil, err
	}
	_, err = q.DeleteHubWebsite(ctx, sqlc.DeleteHubWebsiteParams{
		HubUserDid: did, WebsiteID: id,
		TenantID:       tenantID,
		IdempotencyKey: dbvalue.Text(string(key)),
	})
	return conflictOnNoRows(err)
}

// websiteConflict reports every way a save can lose to existing state as the
// profile conflict. The queries return no row for a missing entry, a full
// profile, or a URL the owner already lists. Two racing requests can still
// reach the unique index or the entry-limit trigger, which reject the loser
// with a database error instead.
func websiteConflict(err error) (*handlerauth.Problem, error) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		duplicate := pgErr.Code == "23505" &&
			pgErr.ConstraintName == "hub_websites_user_url_key"
		full := pgErr.Code == "23514" &&
			strings.HasPrefix(pgErr.Message, "hub_websites profile entry limit")
		if duplicate || full {
			return &handlerauth.Problem{
				Details: hubproblem.ProfileConflictError,
			}, nil
		}
	}
	return conflictOnNoRows(err)
}
