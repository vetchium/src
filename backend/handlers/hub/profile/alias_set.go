package profile

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	operationspec "github.com/vetchium/src/typespec/hub/operations"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/hub/aliaschange"
	"backend/internal/middleware"
)

func SetAlias(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request profilespec.SetAliasRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		handlerauth.RunIdempotent(s, w, r, "hub-profile-alias-set",
			dbvalue.FormatUUID(identity.UserDID), key, request,
			s.CurrentTime().Add(7*24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[operationspec.PendingOperation],
				*handlerauth.Problem, error,
			) {
				var result handlerauth.Result[operationspec.PendingOperation]
				// Serialize different idempotency keys for one user's alias. The
				// pending-operation check must see the prior transaction's commit.
				if err := q.LockIdempotency(r.Context(),
					"hub-profile-alias:"+dbvalue.FormatUUID(identity.UserDID)); err != nil {
					return result, nil, err
				}
				state, err := q.GetHubAliasMutationState(r.Context(),
					sqlc.GetHubAliasMutationStateParams{
						HubUserDid:   identity.UserDID,
						HubSessionID: identity.SessionID,
					})
				if errors.Is(err, pgx.ErrNoRows) {
					return result, &handlerauth.Problem{
						Details: hubproblem.ProfileConflictError,
					}, nil
				}
				if err != nil {
					return result, nil, err
				}
				if !subscriptionspec.Includes(
					subscriptionspec.PlanOID(state.HubPlanOid),
					subscriptionspec.SilverTier,
				) {
					return result, &handlerauth.Problem{
						Details: hubproblem.PlanRequiredError(subscriptionspec.SilverTier),
					}, nil
				}
				if state.HasPendingChange ||
					(state.AliasLastChangedAt.Valid &&
						state.AliasLastChangedAt.Time.Add(7*24*time.Hour).After(s.CurrentTime())) ||
					aliasAlreadySet(state.ProfileAlias, request.ProfileAlias.Value) {
					return result, &handlerauth.Problem{
						Details: hubproblem.ProfileConflictError,
					}, nil
				}
				operationID, err := dbvalue.NewUUID()
				if err != nil {
					return result, nil, err
				}
				commandID, err := dbvalue.NewUUID()
				if err != nil {
					return result, nil, err
				}
				payload, err := json.Marshal(aliaschange.Payload{
					HubUserDID:             hubspec.HubUserDID(dbvalue.FormatUUID(identity.UserDID)),
					ProfileAlias:           request.ProfileAlias.Value,
					PreviousAlias:          storedAlias(state.ProfileAlias),
					ExpectedProfileVersion: state.ProfileVersion,
				})
				if err != nil {
					return result, nil, err
				}
				digest := sha256.Sum256(payload)
				_, err = q.CreateFederationOperation(r.Context(),
					sqlc.CreateFederationOperationParams{
						OperationID: operationID, CommandID: commandID,
						Kind: "hub-alias-change", TargetAuthority: "global-directory",
						AggregateID:        dbvalue.FormatUUID(identity.UserDID),
						OwnerPrincipalType: "hub_user",
						OwnerPrincipalID:   dbvalue.FormatUUID(identity.UserDID),
						IdempotencyKey:     string(key),
						RequestDigest:      digest[:], PayloadBytes: payload,
						ExpiresAt: dbvalue.Timestamp(s.CurrentTime().Add(30 * 24 * time.Hour)),
						TenantID:  s.TenantID, ActorType: "hub_user",
						ActorID: dbvalue.Text(
							dbvalue.FormatUUID(identity.UserDID),
						),
						Source: "hub-api",
					})
				if err != nil {
					return result, nil, err
				}
				return handlerauth.Result[operationspec.PendingOperation]{
					Status: http.StatusAccepted,
					Body: operationspec.PendingOperation{
						OperationID: operationspec.OperationID(dbvalue.FormatUUID(operationID)),
					},
				}, nil, nil
			},
		)
	}
}

func aliasAlreadySet(current pgtype.Text, desired *directoryspec.HubAlias) bool {
	if desired == nil {
		return !current.Valid
	}
	return current.Valid && current.String == string(*desired)
}

func storedAlias(value pgtype.Text) *directoryspec.HubAlias {
	if !value.Valid {
		return nil
	}
	alias := directoryspec.HubAlias(value.String)
	return &alias
}
