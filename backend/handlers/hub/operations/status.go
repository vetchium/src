package operations

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	operationspec "github.com/vetchium/src/typespec/hub/operations"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

func Status(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request operationspec.GetOperationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		operationID, err := dbvalue.ParseUUID(string(request.OperationID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse validated operation ID", err)
			return
		}
		row, err := s.Queries.GetHubFederationOperationStatus(
			r.Context(), sqlc.GetHubFederationOperationStatusParams{
				OperationID:      operationID,
				OwnerPrincipalID: dbvalue.FormatUUID(identity.UserDID),
			},
		)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, hubproblem.OperationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read Hub operation status", err)
			return
		}
		state := operationspec.OperationState(row.State)
		if !operationspec.IsOperationState(state) {
			s.InternalError(r.Context(), w, "decode Hub operation state",
				errors.New("unrecognized federation operation state"))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, operationspec.OperationStatus{
			OperationID: request.OperationID,
			State:       state,
		})
	}
}
