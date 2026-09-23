package profile

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	profilespec "github.com/vetchium/src/typespec/hub/profile"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

type publicFieldsQueries interface {
	SetHubPublicProfile(
		context.Context, sqlc.SetHubPublicProfileParams,
	) (sqlc.SetHubPublicProfileRow, error)
}

func SetPublicFields(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request profilespec.SetPublicFieldsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		handlerauth.RunIdempotent(
			s, w, r, "hub:profile:set-public-fields",
			dbvalue.FormatUUID(identity.UserDID), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				return setPublicFields(
					r.Context(), q, identity.UserDID, s.TenantID,
					key, request,
				)
			},
		)
	}
}

func setPublicFields(
	ctx context.Context, q publicFieldsQueries, did pgtype.UUID,
	tenantID string, key common.IdempotencyKey,
	request profilespec.SetPublicFieldsRequest,
) (handlerauth.Result[struct{}], *handlerauth.Problem, error) {
	biography := pgtype.Text{}
	if request.Biography != nil {
		biography = dbvalue.Text(string(*request.Biography))
	}
	_, err := q.SetHubPublicProfile(ctx, sqlc.SetHubPublicProfileParams{
		HubUserDid:     did,
		DisplayName:    string(request.DisplayName),
		Biography:      biography,
		TenantID:       tenantID,
		IdempotencyKey: dbvalue.Text(string(key)),
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return handlerauth.Result[struct{}]{}, nil, err
	}
	// A no-op returns no updated row. It still succeeds and is replayable.
	return handlerauth.Result[struct{}]{Status: http.StatusNoContent}, nil, nil
}
