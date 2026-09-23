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
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

type profileMutation[T apiserver.Request] func(
	context.Context, *sqlc.Queries, pgtype.UUID, string,
	common.IdempotencyKey, T,
) (*handlerauth.Problem, error)

func mutationHandler[T apiserver.Request](
	s *hubruntime.Server, operation string, newRequest func() T,
	work profileMutation[T],
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		request := newRequest()
		if !apiserver.Decode(s, w, r, request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		handlerauth.RunIdempotent(
			s, w, r, operation, dbvalue.FormatUUID(identity.UserDID),
			key, request, s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				apiProblem, err := work(
					r.Context(), q, identity.UserDID, s.TenantID,
					key, request,
				)
				return handlerauth.Result[struct{}]{
					Status: http.StatusNoContent,
				}, apiProblem, err
			},
		)
	}
}

func conflictOnNoRows(err error) (*handlerauth.Problem, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return &handlerauth.Problem{Details: hubproblem.ProfileConflictError}, nil
	}
	return nil, err
}

func optionalProfileText[T ~string](value *T) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return dbvalue.Text(string(*value))
}

func profileMonth(value profilespec.ProfileMonth) pgtype.Date {
	at, _ := time.Parse("2006-01", string(value))
	return pgtype.Date{Time: at, Valid: true}
}

func optionalProfileMonth(value *profilespec.ProfileMonth) pgtype.Date {
	if value == nil {
		return pgtype.Date{}
	}
	return profileMonth(*value)
}
