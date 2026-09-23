package profile

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

func AddProfessionalEmail(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request profilespec.AddProfessionalEmailRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		handlerauth.RunIdempotent(
			s, w, r, "hub:profile:add-professional-email",
			dbvalue.FormatUUID(identity.UserDID), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[profilespec.ProfessionalEmail],
				*handlerauth.Problem, error,
			) {
				id, err := dbvalue.NewUUID()
				if err != nil {
					return handlerauth.Result[profilespec.ProfessionalEmail]{}, nil, err
				}
				_, domain, _ := strings.Cut(string(request.EmailAddress), "@")
				row, err := q.CreateHubProfessionalEmail(
					r.Context(), sqlc.CreateHubProfessionalEmailParams{
						HubUserDid:          identity.UserDID,
						ProfessionalEmailID: id,
						EmailAddress:        string(request.EmailAddress),
						Domain:              domain,
						TenantID:            s.TenantID,
						IdempotencyKey:      dbvalue.Text(string(key)),
					},
				)
				if professionalEmailConflict(err) {
					return handlerauth.Failure[profilespec.ProfessionalEmail](
						hubproblem.ProfileConflictError,
					)
				}
				if err != nil {
					return handlerauth.Result[profilespec.ProfessionalEmail]{}, nil, err
				}
				return handlerauth.Result[profilespec.ProfessionalEmail]{
					Status: http.StatusCreated,
					Body: professionalEmail(
						row.ProfessionalEmailID, row.EmailAddress, row.Domain,
						row.FirstVerifiedAt, row.LastVerifiedAt, row.CreatedAt,
					),
				}, nil, nil
			},
		)
	}
}

func DeleteProfessionalEmail(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request profilespec.ProfessionalEmailIDRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		handlerauth.RunIdempotent(
			s, w, r, "hub:profile:delete-professional-email",
			dbvalue.FormatUUID(identity.UserDID), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				id, err := dbvalue.ParseUUID(string(request.ID))
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				_, err = q.DeleteHubProfessionalEmail(
					r.Context(), sqlc.DeleteHubProfessionalEmailParams{
						ProfessionalEmailID: id,
						HubUserDid:          identity.UserDID,
						TenantID:            s.TenantID,
						IdempotencyKey:      dbvalue.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[struct{}](
						hubproblem.ProfileNotFoundError,
					)
				}
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				return handlerauth.Result[struct{}]{
					Status: http.StatusNoContent,
				}, nil, nil
			},
		)
	}
}

func professionalEmailConflict(err error) bool {
	if errors.Is(err, pgx.ErrNoRows) {
		return true
	}
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func professionalEmail(
	id pgtype.UUID, address, domain string,
	first, last, created pgtype.Timestamptz,
) profilespec.ProfessionalEmail {
	return profilespec.ProfessionalEmail{
		ID:              profilespec.ProfileEntryID(dbvalue.FormatUUID(id)),
		EmailAddress:    common.EmailAddress(address),
		Domain:          common.ProfessionalDomain(domain),
		FirstVerifiedAt: dbvalue.TimePtr(first),
		LastVerifiedAt:  dbvalue.TimePtr(last),
		CreatedAt:       created.Time.UTC(),
	}
}
