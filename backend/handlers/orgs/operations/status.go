package operations

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	operationspec "github.com/vetchium/src/typespec/orgs/operations"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

// Status reports an operation only to the Org user who started it.
func Status(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request operationspec.GetOperationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		operationID, err := dbvalue.ParseUUID(string(request.OperationID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse validated operation ID", err)
			return
		}
		row, err := s.Queries.GetOrgFederationOperationStatus(
			r.Context(), sqlc.GetOrgFederationOperationStatusParams{
				OperationID:      operationID,
				OwnerPrincipalID: dbvalue.FormatUUID(identity.UserID),
			},
		)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.OperationNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read Org operation status", err)
			return
		}
		state := operationspec.OperationState(row.State)
		if !operationspec.IsOperationState(state) {
			s.InternalError(r.Context(), w, "decode Org operation state",
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
