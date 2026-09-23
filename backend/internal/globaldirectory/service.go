// Package globaldirectory owns global Hub identity and profile-slug commands.
package globaldirectory

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/dbvalue"
	"backend/internal/globaldb/sqlc"
)

const (
	reserveOperation  = "global-directory.reserve-hub-principal.v1"
	activateOperation = "global-directory.activate-hub-principal.v1"
	aliasOperation    = "global-directory.set-hub-alias.v1"
)

var ErrNotFound = errors.New("global directory entry not found")

type Outcome struct {
	Status    int
	Principal *directoryspec.PrincipalCommandResponse
	Problem   *problem.Details
}

type Service struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, queries: sqlc.New(pool)}
}

func (s *Service) ReapExpiredReservations(ctx context.Context) (int64, error) {
	count, err := s.queries.ReapExpiredHubPrincipalReservations(ctx)
	if err != nil {
		return 0, fmt.Errorf("reap expired Hub principal reservations: %w", err)
	}
	return count, nil
}

func (s *Service) ResolveProfileSlug(
	ctx context.Context, slug string,
) (directoryspec.ResolveProfileSlugResponse, error) {
	row, err := s.queries.ResolveProfileSlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return directoryspec.ResolveProfileSlugResponse{}, ErrNotFound
	}
	if err != nil {
		return directoryspec.ResolveProfileSlugResponse{}, fmt.Errorf(
			"resolve profile slug: %w", err,
		)
	}
	return directoryspec.ResolveProfileSlugResponse{
		HubUserDID:     hub.HubUserDID(dbvalue.FormatUUID(row.HubUserDid)),
		Slug:           row.Slug,
		Kind:           directoryspec.ProfileSlugKind(row.Kind),
		HomeTenantID:   directoryspec.TenantID(row.HomeTenantID),
		RoutingVersion: row.RoutingVersion,
	}, nil
}

func (s *Service) ReserveHubPrincipal(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.ReserveHubPrincipalRequest,
) (Outcome, error) {
	return s.command(ctx, caller, reserveOperation, request.CommandID, request,
		func(q *sqlc.Queries) (mutation, *problem.Details, error) {
			if request.HomeTenantID != caller {
				return mutation{}, details(
					coordinatorproblem.DirectoryCallerTenantMismatchError,
				), nil
			}
			did, _ := dbvalue.ParseUUID(string(request.HubUserDID))
			commandID, _ := dbvalue.ParseUUID(string(request.CommandID))
			row, err := q.ReserveHubPrincipal(
				ctx, sqlc.ReserveHubPrincipalParams{
					HubUserDid: did, HomeTenantID: string(request.HomeTenantID),
					CommandID: commandID,
					ProvisioningExpiresAt: dbvalue.Timestamp(
						request.ProvisioningExpiresAt,
					),
					Handle: string(request.Handle),
				},
			)
			if isUniqueViolation(err) {
				return mutation{}, details(
					coordinatorproblem.DirectoryClaimConflictError,
				), nil
			}
			if isConstraintViolation(
				err, "23514", "hub_principals_state_check",
			) {
				return mutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if err != nil {
				return mutation{}, nil, fmt.Errorf(
					"reserve Hub principal: %w", err,
				)
			}
			response := principalResponse(
				row.HubUserDid, row.Handle, row.ProfileAlias,
				row.HomeTenantID, row.RoutingVersion, row.State,
			)
			return changedMutation(
				response, row.DirectoryVersion,
				"global_directory.hub_principal_reserved",
				"hub_principal_reserved.v1",
			), nil, nil
		},
	)
}

func (s *Service) ActivateHubPrincipal(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.ActivateHubPrincipalRequest,
) (Outcome, error) {
	return s.command(ctx, caller, activateOperation, request.CommandID, request,
		func(q *sqlc.Queries) (mutation, *problem.Details, error) {
			did, _ := dbvalue.ParseUUID(string(request.HubUserDID))
			principal, err := q.GetPrincipal(ctx, did)
			if errors.Is(err, pgx.ErrNoRows) {
				return mutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if err != nil {
				return mutation{}, nil, fmt.Errorf(
					"get Hub principal for activation: %w", err,
				)
			}
			if principal.HomeTenantID != string(caller) {
				return mutation{}, details(
					coordinatorproblem.DirectoryCallerTenantMismatchError,
				), nil
			}
			activated, err := q.ActivateHubPrincipal(
				ctx, sqlc.ActivateHubPrincipalParams{
					HubUserDid: did, CallerTenantID: string(caller),
				},
			)
			if errors.Is(err, pgx.ErrNoRows) {
				return mutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if err != nil {
				return mutation{}, nil, fmt.Errorf(
					"activate Hub principal: %w", err,
				)
			}
			response, err := commandResponse(ctx, q, did)
			if err != nil {
				return mutation{}, nil, err
			}
			return changedMutation(
				response, activated.DirectoryVersion,
				"global_directory.hub_principal_activated",
				"hub_principal_activated.v1",
			), nil, nil
		},
	)
}

func (s *Service) SetHubAlias(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.SetHubAliasRequest,
) (Outcome, error) {
	return s.command(ctx, caller, aliasOperation, request.CommandID, request,
		func(q *sqlc.Queries) (mutation, *problem.Details, error) {
			did, _ := dbvalue.ParseUUID(string(request.HubUserDID))
			locked, err := q.LockPrincipalForAlias(ctx, did)
			if errors.Is(err, pgx.ErrNoRows) {
				return mutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if err != nil {
				return mutation{}, nil, fmt.Errorf(
					"lock Hub principal for alias: %w", err,
				)
			}
			if locked.HomeTenantID != string(caller) {
				return mutation{}, details(
					coordinatorproblem.DirectoryCallerTenantMismatchError,
				), nil
			}
			if locked.State != sqlc.VetchiumGlobalPrincipalStateActive {
				return mutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			// A delayed downgrade release must not erase an alias claimed after
			// the owner upgraded again or changed it in another command.
			if request.DowngradeReleaseIfAlias != nil &&
				!sameAlias(locked.ProfileAlias, request.DowngradeReleaseIfAlias) {
				response, err := commandResponse(ctx, q, did)
				return mutation{response: response}, nil, err
			}
			if sameAlias(locked.ProfileAlias, request.ProfileAlias) {
				response, err := commandResponse(ctx, q, did)
				return mutation{response: response}, nil, err
			}
			if request.DowngradeReleaseIfAlias == nil &&
				(!locked.AliasChangeAllowed.Valid ||
					!locked.AliasChangeAllowed.Bool) {
				return mutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if err := q.DeleteHubAlias(ctx, did); err != nil {
				return mutation{}, nil, fmt.Errorf("delete Hub alias: %w", err)
			}
			if request.ProfileAlias != nil {
				err := q.InsertHubAlias(ctx, sqlc.InsertHubAliasParams{
					ProfileAlias: string(*request.ProfileAlias), HubUserDid: did,
				})
				if isUniqueViolation(err) {
					return mutation{}, details(
						coordinatorproblem.DirectoryClaimConflictError,
					), nil
				}
				if err != nil {
					return mutation{}, nil, fmt.Errorf("insert Hub alias: %w", err)
				}
			}
			version, err := q.RecordHubAliasChange(ctx,
				sqlc.RecordHubAliasChangeParams{
					HubUserDid:     did,
					RecordCooldown: request.DowngradeReleaseIfAlias == nil,
				})
			if err != nil {
				return mutation{}, nil, fmt.Errorf("record Hub alias change: %w", err)
			}
			response, err := commandResponse(ctx, q, did)
			if err != nil {
				return mutation{}, nil, err
			}
			eventType := "hub_alias_set.v1"
			auditAction := "global_directory.hub_alias_changed"
			if request.ProfileAlias == nil {
				eventType = "hub_alias_released.v1"
			}
			if request.DowngradeReleaseIfAlias != nil {
				auditAction = "global_directory.hub_alias_downgrade_released"
			}
			return changedMutation(
				response, version, auditAction,
				eventType,
			), nil, nil
		},
	)
}

type mutation struct {
	response         directoryspec.PrincipalCommandResponse
	changed          bool
	directoryVersion int64
	auditAction      string
	eventType        string
}

func changedMutation(
	response directoryspec.PrincipalCommandResponse, version int64,
	auditAction, eventType string,
) mutation {
	return mutation{
		response: response, changed: true, directoryVersion: version,
		auditAction: auditAction, eventType: eventType,
	}
}

func (s *Service) command(
	ctx context.Context, caller directoryspec.TenantID, operation string,
	commandID directoryspec.CommandID, request any,
	work func(*sqlc.Queries) (mutation, *problem.Details, error),
) (Outcome, error) {
	requestJSON, err := json.Marshal(request)
	if err != nil {
		return Outcome{}, fmt.Errorf("encode directory command: %w", err)
	}
	digest := sha256.Sum256(requestJSON)
	id, err := dbvalue.ParseUUID(string(commandID))
	if err != nil {
		return Outcome{}, fmt.Errorf("parse directory command ID: %w", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Outcome{}, fmt.Errorf("begin directory command: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if err := q.AcquireCommandLock(ctx, string(commandID)); err != nil {
		return Outcome{}, fmt.Errorf("lock directory command: %w", err)
	}
	existing, err := q.GetCommandResult(ctx, id)
	if err == nil {
		if existing.Operation != operation ||
			existing.CallerTenantID != string(caller) ||
			!bytes.Equal(existing.RequestDigest, digest[:]) {
			return problemOutcome(problem.IdempotencyKeyConflictError), nil
		}
		outcome, err := decodeOutcome(
			int(existing.ResponseStatus), existing.ResponseBody,
		)
		if err != nil {
			return Outcome{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return Outcome{}, fmt.Errorf("commit directory replay: %w", err)
		}
		return outcome, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Outcome{}, fmt.Errorf("get directory command result: %w", err)
	}

	commandTx, err := tx.Begin(ctx)
	if err != nil {
		return Outcome{}, fmt.Errorf("begin directory mutation: %w", err)
	}
	commandQueries := sqlc.New(commandTx)
	change, expected, err := work(commandQueries)
	if expected != nil {
		if rollbackErr := commandTx.Rollback(ctx); rollbackErr != nil {
			return Outcome{}, fmt.Errorf(
				"rollback rejected directory mutation: %w", rollbackErr,
			)
		}
		outcome := problemOutcome(*expected)
		if err := persistOutcome(
			ctx, q, id, operation, caller, digest[:], outcome,
		); err != nil {
			return Outcome{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return Outcome{}, fmt.Errorf("commit directory rejection: %w", err)
		}
		return outcome, nil
	}
	if err != nil {
		_ = commandTx.Rollback(ctx)
		return Outcome{}, err
	}
	outcome := Outcome{
		Status: http.StatusOK, Principal: &change.response,
	}
	if change.changed {
		if err := appendChangeRecords(
			ctx, commandQueries, id, caller, change,
		); err != nil {
			_ = commandTx.Rollback(ctx)
			return Outcome{}, err
		}
	}
	if err := persistOutcome(
		ctx, commandQueries, id, operation, caller, digest[:], outcome,
	); err != nil {
		_ = commandTx.Rollback(ctx)
		return Outcome{}, err
	}
	if err := commandTx.Commit(ctx); err != nil {
		return Outcome{}, fmt.Errorf("finish directory mutation: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Outcome{}, fmt.Errorf("commit directory command: %w", err)
	}
	return outcome, nil
}

func appendChangeRecords(
	ctx context.Context, q *sqlc.Queries, commandID pgtype.UUID,
	caller directoryspec.TenantID, change mutation,
) error {
	payload, err := json.Marshal(struct {
		SchemaVersion int                                    `json:"schema_version"`
		Principal     directoryspec.PrincipalCommandResponse `json:"principal"`
	}{SchemaVersion: 1, Principal: change.response})
	if err != nil {
		return fmt.Errorf("encode directory change record: %w", err)
	}
	entityID := string(change.response.HubUserDID)
	if err := q.InsertGlobalAuditEvent(
		ctx, sqlc.InsertGlobalAuditEventParams{
			Action: change.auditAction, EntityType: "hub_principal",
			EntityID: entityID, ActorTenantID: string(caller),
			CommandID: commandID, Payload: payload,
		},
	); err != nil {
		return fmt.Errorf("insert global directory audit event: %w", err)
	}
	if err := q.InsertGlobalOutboxEvent(
		ctx, sqlc.InsertGlobalOutboxEventParams{
			AggregateType: "hub_principal", AggregateID: entityID,
			AggregateVersion: change.directoryVersion,
			EventType:        change.eventType, Payload: payload,
		},
	); err != nil {
		return fmt.Errorf("insert global directory outbox event: %w", err)
	}
	return nil
}

func persistOutcome(
	ctx context.Context, q *sqlc.Queries, commandID pgtype.UUID,
	operation string, caller directoryspec.TenantID, digest []byte,
	outcome Outcome,
) error {
	body, err := encodeOutcome(outcome)
	if err != nil {
		return err
	}
	if err := q.InsertCommandResult(ctx, sqlc.InsertCommandResultParams{
		CommandID: commandID, Operation: operation,
		CallerTenantID: string(caller), RequestDigest: digest,
		ResponseStatus: int32(outcome.Status), ResponseBody: body,
	}); err != nil {
		return fmt.Errorf("insert global directory command result: %w", err)
	}
	return nil
}

func encodeOutcome(outcome Outcome) ([]byte, error) {
	if outcome.Principal != nil {
		body, err := json.Marshal(outcome.Principal)
		if err != nil {
			return nil, fmt.Errorf("encode directory success: %w", err)
		}
		return body, nil
	}
	if outcome.Problem != nil {
		body, err := json.Marshal(outcome.Problem)
		if err != nil {
			return nil, fmt.Errorf("encode directory problem: %w", err)
		}
		return body, nil
	}
	return nil, fmt.Errorf("directory outcome has no body")
}

func decodeOutcome(status int, body []byte) (Outcome, error) {
	if status >= http.StatusBadRequest {
		var details problem.Details
		if err := json.Unmarshal(body, &details); err != nil {
			return Outcome{}, fmt.Errorf("decode directory problem replay: %w", err)
		}
		return Outcome{Status: status, Problem: &details}, nil
	}
	var response directoryspec.PrincipalCommandResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return Outcome{}, fmt.Errorf("decode directory success replay: %w", err)
	}
	return Outcome{Status: status, Principal: &response}, nil
}

func commandResponse(
	ctx context.Context, q *sqlc.Queries, did pgtype.UUID,
) (directoryspec.PrincipalCommandResponse, error) {
	row, err := q.GetPrincipalCommandView(ctx, did)
	if err != nil {
		return directoryspec.PrincipalCommandResponse{}, fmt.Errorf(
			"read directory command response: %w", err,
		)
	}
	return principalResponse(
		row.HubUserDid, row.Handle, row.ProfileAlias, row.HomeTenantID,
		row.RoutingVersion, row.State,
	), nil
}

func principalResponse(
	did pgtype.UUID, handle string, profileAlias pgtype.Text,
	homeTenantID string, routingVersion int64,
	state sqlc.VetchiumGlobalPrincipalState,
) directoryspec.PrincipalCommandResponse {
	response := directoryspec.PrincipalCommandResponse{
		HubUserDID:     hub.HubUserDID(dbvalue.FormatUUID(did)),
		Handle:         hub.HubHandle(handle),
		HomeTenantID:   directoryspec.TenantID(homeTenantID),
		RoutingVersion: routingVersion,
		State:          directoryspec.PrincipalState(state),
	}
	if profileAlias.Valid {
		value := directoryspec.HubAlias(profileAlias.String)
		response.ProfileAlias = &value
	}
	return response
}

func sameAlias(current pgtype.Text, requested *directoryspec.HubAlias) bool {
	if requested == nil {
		return !current.Valid
	}
	return current.Valid && current.String == string(*requested)
}

func problemOutcome(value problem.Details) Outcome {
	return Outcome{Status: value.Status, Problem: &value}
}

func details(value problem.Details) *problem.Details { return &value }

func isUniqueViolation(err error) bool {
	return isConstraintViolation(err, "23505", "")
}

func isConstraintViolation(err error, code, constraint string) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) && databaseError.Code == code &&
		(constraint == "" || databaseError.ConstraintName == constraint)
}
