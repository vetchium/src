package globaldirectory

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
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
	count, err := s.queries.PruneTerminalHubAccountEmailChangeReservations(
		ctx, dbvalue.Timestamp(time.Now().Add(-terminalReservationLifetime)),
	)
	if err != nil {
		return 0, fmt.Errorf(
			"prune terminal Hub account email change reservations: %w", err,
		)
	}
	return count, nil
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

			existing, err := q.LockHubAccountEmailChangeReservation(ctx, changeID)
			found := true
			if errors.Is(err, pgx.ErrNoRows) {
				found = false
			} else if err != nil {
				return emailChangeMutation{}, nil, fmt.Errorf(
					"lock Hub account email change reservation: %w", err,
				)
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
				sameDigest := existing.EmailDigest != nil &&
					string(existing.EmailDigest) == string(newDigest)
				if (existing.State == sqlc.VetchiumGlobalEmailChangeReservationStateReserved ||
					existing.State == sqlc.VetchiumGlobalEmailChangeReservationStateFinalized) &&
					existing.HubUserDid == did && sameDigest {
					return emailChangeMutation{
						response: directoryspec.HubAccountEmailChangeReservationResponse{
							State: directoryspec.EmailChangeReservationState(existing.State),
						},
					}, nil, nil
				}
				// A change id is minted once per durable local operation and
				// should never be reused for a different user or digest.
				return emailChangeMutation{}, nil, fmt.Errorf(
					"email change reservation %s exists in state %s for a different user or digest",
					request.ChangeID, existing.State,
				)
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
			_ = row
			return emailChangeMutation{
				response: directoryspec.HubAccountEmailChangeReservationResponse{
					State: directoryspec.EmailChangeReserved,
				},
				changed: true, skipOutbox: true,
				entityType: "hub_account_email_claim", entityID: string(request.HubUserDID),
				auditAction: "global_directory.hub_account_email_change_reserved",
			}, nil, nil
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
			existing, err := q.LockHubAccountEmailChangeReservation(ctx, changeID)
			if errors.Is(err, pgx.ErrNoRows) {
				return emailChangeMutation{}, details(
					coordinatorproblem.DirectoryStateConflictError,
				), nil
			}
			if err != nil {
				return emailChangeMutation{}, nil, fmt.Errorf(
					"lock Hub account email change reservation: %w", err,
				)
			}
			switch existing.State {
			case sqlc.VetchiumGlobalEmailChangeReservationStateFinalized:
				return emailChangeMutation{
					response: directoryspec.HubAccountEmailChangeReservationResponse{
						State: directoryspec.EmailChangeFinalized,
					},
				}, nil, nil
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
			return emailChangeMutation{
				response: directoryspec.HubAccountEmailChangeReservationResponse{
					State: directoryspec.EmailChangeFinalized,
				},
				changed: true, skipOutbox: true,
				entityType: "hub_account_email_claim", entityID: string(request.HubUserDID),
				auditAction: "global_directory.hub_account_email_changed",
			}, nil, nil
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
			changeID, _ := dbvalue.ParseUUID(string(request.ChangeID))
			existing, err := q.LockHubAccountEmailChangeReservation(ctx, changeID)
			if errors.Is(err, pgx.ErrNoRows) {
				if rejection, err := requireActivePrincipal(ctx, q, caller, did); rejection != nil || err != nil {
					return emailChangeMutation{}, rejection, err
				}
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
				return emailChangeMutation{
					response: directoryspec.HubAccountEmailChangeReservationResponse{
						State: directoryspec.EmailChangeCancelled,
					},
					changed: true, skipOutbox: true,
					entityType: "hub_account_email_claim", entityID: string(request.HubUserDID),
					auditAction: "global_directory.hub_account_email_change_abandoned",
				}, nil, nil
			}
			if err != nil {
				return emailChangeMutation{}, nil, fmt.Errorf(
					"lock Hub account email change reservation: %w", err,
				)
			}
			if rejection, err := requireActivePrincipal(ctx, q, caller, did); rejection != nil || err != nil {
				return emailChangeMutation{}, rejection, err
			}
			switch existing.State {
			case sqlc.VetchiumGlobalEmailChangeReservationStateCancelled:
				return emailChangeMutation{
					response: directoryspec.HubAccountEmailChangeReservationResponse{
						State: directoryspec.EmailChangeCancelled,
					},
				}, nil, nil
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
			return emailChangeMutation{
				response: directoryspec.HubAccountEmailChangeReservationResponse{
					State: directoryspec.EmailChangeCancelled,
				},
				changed: true, skipOutbox: true,
				entityType: "hub_account_email_claim", entityID: string(request.HubUserDID),
				auditAction: "global_directory.hub_account_email_change_abandoned",
			}, nil, nil
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
