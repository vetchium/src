package globaldirectory

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/dbvalue"
	"backend/internal/globaldb/sqlc"
)

const (
	reserveEmailChangeOperation  = "global-directory.reserve-hub-account-email-change.v1"
	finalizeEmailChangeOperation = "global-directory.finalize-hub-account-email-change.v1"
	abandonEmailChangeOperation  = "global-directory.abandon-hub-account-email-change.v1"

	// terminalReservationLifetime is how long a cancelled or finalized
	// reservation stays as a fencing tombstone before GU-DIR-010 prunes it.
	terminalReservationLifetime = 7 * 24 * time.Hour
	pruneBatchSize              = 1000

	reservationAggregate = "hub_account_email_change_reservation"
)

type EmailChangeOutcome struct {
	Status      int
	Reservation *directoryspec.HubAccountEmailChangeReservationResponse
	Problem     *problem.Details
}

type emailChangeMutation = mutation[directoryspec.HubAccountEmailChangeReservationResponse]

// PruneTerminalHubAccountEmailChangeReservations implements the second half
// of GU-DIR-010: terminal (cancelled or finalized) reservations are pruned
// only after they can no longer fence anything, since the coordinator itself
// rejects any reserve past a reservation's own recorded not_after.
func (s *Service) PruneTerminalHubAccountEmailChangeReservations(
	ctx context.Context,
) (int64, error) {
	cutoff := dbvalue.Timestamp(time.Now().Add(-terminalReservationLifetime))
	var total int64
	for {
		count, err := s.queries.PruneTerminalHubAccountEmailChangeReservations(
			ctx, sqlc.PruneTerminalHubAccountEmailChangeReservationsParams{
				Cutoff: cutoff, BatchSize: pruneBatchSize,
			},
		)
		total += count
		if err != nil {
			return total, fmt.Errorf(
				"prune terminal Hub account email change reservations: %w", err,
			)
		}
		if count < pruneBatchSize {
			return total, nil
		}
	}
}

// reservationChanged reports a reservation transition. A reservation is
// written once and changes state at most once afterwards, so its outbox
// version is 1 when written and 2 after that terminal transition. Neither the
// audit nor the outbox payload carries a digest.
func reservationChanged(
	changeID directoryspec.CommandID, did hub.HubUserDID,
	state directoryspec.EmailChangeReservationState, version int64,
	auditAction string, extra ...outboxEvent,
) emailChangeMutation {
	return emailChangeMutation{
		response: directoryspec.HubAccountEmailChangeReservationResponse{
			State: state,
		},
		changed:    true,
		entityType: "hub_account_email_claim", entityID: string(did),
		auditAction: auditAction,
		outboxEvents: append(
			[]outboxEvent{reservationEvent(string(changeID), did, state, version)},
			extra...,
		),
	}
}

func reservationEvent(
	changeID string, did hub.HubUserDID,
	state directoryspec.EmailChangeReservationState, version int64,
) outboxEvent {
	return outboxEvent{
		aggregateType: reservationAggregate, aggregateID: changeID,
		version:   version,
		eventType: "hub_account_email_change_" + string(state) + ".v1",
		payload: struct {
			SchemaVersion int                                       `json:"schema_version"`
			ChangeID      string                                    `json:"change_id"`
			HubUserDID    hub.HubUserDID                            `json:"hub_user_did"`
			State         directoryspec.EmailChangeReservationState `json:"state"`
		}{SchemaVersion: 1, ChangeID: changeID, HubUserDID: did, State: state},
	}
}

func unchangedReservation(
	state directoryspec.EmailChangeReservationState,
) emailChangeMutation {
	return emailChangeMutation{
		response: directoryspec.HubAccountEmailChangeReservationResponse{
			State: state,
		},
	}
}

// ResolveHubAccountEmail never reveals the DID (GU-DIR-001).
func (s *Service) ResolveHubAccountEmail(
	ctx context.Context, request directoryspec.ResolveHubAccountEmailRequest,
) (directoryspec.ResolveHubAccountEmailResponse, *problem.Details, error) {
	if directoryspec.DigestKeyID(s.digestKeyID) != request.DigestKeyID {
		return directoryspec.ResolveHubAccountEmailResponse{},
			details(coordinatorproblem.DirectoryDigestKeyMismatchError), nil
	}
	digest, err := decodeDigest(request.EmailDigest)
	if err != nil {
		return directoryspec.ResolveHubAccountEmailResponse{}, nil, err
	}
	row, err := s.queries.ResolveHubAccountEmail(ctx, digest)
	if errors.Is(err, pgx.ErrNoRows) {
		return directoryspec.ResolveHubAccountEmailResponse{}, nil, ErrNotFound
	}
	if err != nil {
		return directoryspec.ResolveHubAccountEmailResponse{}, nil, fmt.Errorf(
			"resolve Hub account email: %w", err,
		)
	}
	return directoryspec.ResolveHubAccountEmailResponse{
		HomeTenantID: directoryspec.TenantID(row.HomeTenantID),
	}, nil, nil
}

func (s *Service) emailChangeCommand(
	ctx context.Context, caller directoryspec.TenantID, operation string,
	commandID directoryspec.CommandID, request any,
	work func(*sqlc.Queries) (emailChangeMutation, *problem.Details, error),
) (EmailChangeOutcome, error) {
	outcome, err := runCommand(
		ctx, s.pool, caller, operation, commandID, request, work,
	)
	return EmailChangeOutcome{
		Status: outcome.status, Reservation: outcome.body,
		Problem: outcome.problem,
	}, err
}

// lockOwnedReservation locks a reservation and requires it to belong to did.
// The caller has already proved it owns did, but a change id alone proves
// nothing: without this check a tenant could finalize or cancel another
// user's reservation by naming its change id.
func lockOwnedReservation(
	ctx context.Context, q *sqlc.Queries, changeID, did pgtype.UUID,
) (sqlc.LockHubAccountEmailChangeReservationRow, bool, *problem.Details, error) {
	existing, err := q.LockHubAccountEmailChangeReservation(ctx, changeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return existing, false, nil, nil
	}
	if err != nil {
		return existing, false, nil, fmt.Errorf(
			"lock Hub account email change reservation: %w", err,
		)
	}
	if existing.HubUserDid != did {
		return existing, true, details(
			coordinatorproblem.DirectoryStateConflictError,
		), nil
	}
	return existing, true, nil, nil
}

// ReserveHubAccountEmailChange implements GU-DIR-004.
func (s *Service) ReserveHubAccountEmailChange(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.ReserveHubAccountEmailChangeRequest,
) (EmailChangeOutcome, error) {
	return s.emailChangeCommand(
		ctx, caller, reserveEmailChangeOperation, request.CommandID, request,
		func(q *sqlc.Queries) (emailChangeMutation, *problem.Details, error) {
			if directoryspec.DigestKeyID(s.digestKeyID) != request.DigestKeyID {
				return emailChangeMutation{}, details(
					coordinatorproblem.DirectoryDigestKeyMismatchError,
				), nil
			}
			did, _ := dbvalue.ParseUUID(string(request.HubUserDID))
			if rejection, err := requireActivePrincipal(ctx, q, caller, did); rejection != nil || err != nil {
				return emailChangeMutation{}, rejection, err
			}
			changeID, _ := dbvalue.ParseUUID(string(request.ChangeID))
			newDigest, err := decodeDigest(request.NewEmailDigest)
			if err != nil {
				return emailChangeMutation{}, nil, err
			}

			existing, found, rejection, err := lockOwnedReservation(
				ctx, q, changeID, did,
			)
			if rejection != nil || err != nil {
				return emailChangeMutation{}, rejection, err
			}

			// Checked before the row's own state, and even when the row is
			// missing, so a stray retry past the deadline is always
			// rejected rather than silently reserved (GU-DIR-004).
			if time.Now().After(request.NotAfter) {
				return emailChangeMutation{}, details(
					coordinatorproblem.DirectoryReservationExpiredError,
				), nil
			}

			if found {
				if existing.State == sqlc.VetchiumGlobalEmailChangeReservationStateCancelled {
					return emailChangeMutation{}, details(
						coordinatorproblem.DirectoryReservationCancelledError,
					), nil
				}
				// A change id is minted once per durable local operation, so
				// the same id with another digest is a caller defect.
				if !bytes.Equal(existing.EmailDigest, newDigest) {
					return emailChangeMutation{}, details(
						coordinatorproblem.DirectoryStateConflictError,
					), nil
				}
				return unchangedReservation(
					directoryspec.EmailChangeReservationState(existing.State),
				), nil, nil
			}

			row, err := q.ReserveHubAccountEmailChange(
				ctx, sqlc.ReserveHubAccountEmailChangeParams{
					HubUserDid: did, ChangeID: changeID, EmailDigest: newDigest,
					NotAfter:  dbvalue.Timestamp(request.NotAfter),
					CommandID: mustParseUUID(request.CommandID),
				},
			)
			if isConstraintViolation(err, "23505", "hub_account_email_claims_pkey") {
				return emailChangeMutation{}, details(
					coordinatorproblem.DirectoryEmailClaimConflictError,
				), nil
			}
			if err != nil {
				return emailChangeMutation{}, nil, fmt.Errorf(
					"reserve Hub account email change: %w", err,
				)
			}
			stale := make([]outboxEvent, 0, len(row.StaleChangeIds))
			for _, staleID := range row.StaleChangeIds {
				stale = append(stale, reservationEvent(
					dbvalue.FormatUUID(staleID), request.HubUserDID,
					directoryspec.EmailChangeCancelled, 2,
				))
			}
			return reservationChanged(
				request.ChangeID, request.HubUserDID,
				directoryspec.EmailChangeReserved, 1,
				"global_directory.hub_account_email_change_reserved", stale...,
			), nil, nil
		},
	)
}

// FinalizeHubAccountEmailChange implements GU-DIR-005.
func (s *Service) FinalizeHubAccountEmailChange(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.FinalizeHubAccountEmailChangeRequest,
) (EmailChangeOutcome, error) {
	return s.emailChangeCommand(
		ctx, caller, finalizeEmailChangeOperation, request.CommandID, request,
		func(q *sqlc.Queries) (emailChangeMutation, *problem.Details, error) {
			did, _ := dbvalue.ParseUUID(string(request.HubUserDID))
			if rejection, err := requireActivePrincipal(ctx, q, caller, did); rejection != nil || err != nil {
				return emailChangeMutation{}, rejection, err
			}
			changeID, _ := dbvalue.ParseUUID(string(request.ChangeID))
			existing, found, rejection, err := lockOwnedReservation(
				ctx, q, changeID, did,
			)
			if rejection != nil || err != nil {
				return emailChangeMutation{}, rejection, err
			}
			if !found {
				return emailChangeMutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			switch existing.State {
			case sqlc.VetchiumGlobalEmailChangeReservationStateFinalized:
				return unchangedReservation(directoryspec.EmailChangeFinalized), nil, nil
			case sqlc.VetchiumGlobalEmailChangeReservationStateCancelled:
				return emailChangeMutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if _, err := q.FinalizeHubAccountEmailChange(
				ctx, sqlc.FinalizeHubAccountEmailChangeParams{
					ChangeID: changeID, HubUserDid: did,
				},
			); err != nil {
				return emailChangeMutation{}, nil, fmt.Errorf(
					"finalize Hub account email change: %w", err,
				)
			}
			return reservationChanged(
				request.ChangeID, request.HubUserDID,
				directoryspec.EmailChangeFinalized, 2,
				"global_directory.hub_account_email_changed",
			), nil, nil
		},
	)
}

// AbandonHubAccountEmailChange implements GU-DIR-006.
func (s *Service) AbandonHubAccountEmailChange(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.AbandonHubAccountEmailChangeRequest,
) (EmailChangeOutcome, error) {
	return s.emailChangeCommand(
		ctx, caller, abandonEmailChangeOperation, request.CommandID, request,
		func(q *sqlc.Queries) (emailChangeMutation, *problem.Details, error) {
			did, _ := dbvalue.ParseUUID(string(request.HubUserDID))
			if rejection, err := requireActivePrincipal(ctx, q, caller, did); rejection != nil || err != nil {
				return emailChangeMutation{}, rejection, err
			}
			changeID, _ := dbvalue.ParseUUID(string(request.ChangeID))
			existing, found, rejection, err := lockOwnedReservation(
				ctx, q, changeID, did,
			)
			if rejection != nil || err != nil {
				return emailChangeMutation{}, rejection, err
			}
			if !found {
				if err := q.InsertAbandonedHubAccountEmailChangeTombstone(
					ctx, sqlc.InsertAbandonedHubAccountEmailChangeTombstoneParams{
						ChangeID: changeID, HubUserDid: did,
						NotAfter: dbvalue.Timestamp(request.NotAfter),
					},
				); err != nil {
					return emailChangeMutation{}, nil, fmt.Errorf(
						"insert abandoned Hub account email change tombstone: %w", err,
					)
				}
				return reservationChanged(
					request.ChangeID, request.HubUserDID,
					directoryspec.EmailChangeCancelled, 1,
					"global_directory.hub_account_email_change_abandoned",
				), nil, nil
			}
			switch existing.State {
			case sqlc.VetchiumGlobalEmailChangeReservationStateCancelled:
				return unchangedReservation(directoryspec.EmailChangeCancelled), nil, nil
			case sqlc.VetchiumGlobalEmailChangeReservationStateFinalized:
				// The tenant never abandons after applying locally; reaching
				// here means a bug on the caller's side.
				return emailChangeMutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if _, err := q.AbandonReservedHubAccountEmailChange(ctx, changeID); err != nil {
				return emailChangeMutation{}, nil, fmt.Errorf(
					"abandon reserved Hub account email change: %w", err,
				)
			}
			return reservationChanged(
				request.ChangeID, request.HubUserDID,
				directoryspec.EmailChangeCancelled, 2,
				"global_directory.hub_account_email_change_abandoned",
			), nil, nil
		},
	)
}

// requireActivePrincipal enforces the blanket GU-DIR rule that every command
// checks the caller tenant against the principal's home_tenant_id and
// requires an active principal, except where a requirement states
// otherwise.
func requireActivePrincipal(
	ctx context.Context, q *sqlc.Queries, caller directoryspec.TenantID,
	did pgtype.UUID,
) (*problem.Details, error) {
	principal, err := q.GetPrincipal(ctx, did)
	if errors.Is(err, pgx.ErrNoRows) {
		return details(coordinatorproblem.DirectoryStateConflictError), nil
	}
	if err != nil {
		return nil, fmt.Errorf("get Hub principal: %w", err)
	}
	if principal.HomeTenantID != string(caller) {
		return details(coordinatorproblem.DirectoryCallerTenantMismatchError), nil
	}
	if principal.State != sqlc.VetchiumGlobalPrincipalStateActive {
		return details(coordinatorproblem.DirectoryStateConflictError), nil
	}
	return nil, nil
}

func decodeDigest(value directoryspec.EmailDigest) ([]byte, error) {
	digest, err := hex.DecodeString(string(value))
	if err != nil || len(digest) != 32 {
		return nil, fmt.Errorf("invalid email digest")
	}
	return digest, nil
}

func mustParseUUID(value directoryspec.CommandID) pgtype.UUID {
	parsed, _ := dbvalue.ParseUUID(string(value))
	return parsed
}
