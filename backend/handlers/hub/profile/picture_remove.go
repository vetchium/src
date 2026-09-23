package profile

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

func RemovePicture(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		handlerauth.RunIdempotent(
			s, w, r, "hub:profile:remove-picture",
			dbvalue.FormatUUID(identity.UserDID), key, struct{}{},
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				_, err := q.RemoveHubProfilePicture(
					r.Context(), sqlc.RemoveHubProfilePictureParams{
						HubUserDid: identity.UserDID, TenantID: s.TenantID,
						IdempotencyKey: dbvalue.Text(string(key)),
					},
				)
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				return handlerauth.Result[struct{}]{
					Status: http.StatusNoContent,
				}, nil, nil
			},
		)
	}
}
