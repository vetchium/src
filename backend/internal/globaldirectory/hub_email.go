package globaldirectory

import (
	"context"
	"encoding/hex"
	"encoding/json"
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
	claimProfessionalOperation   = "global-directory.claim-hub-professional-email.v1"
	releaseProfessionalOperation = "global-directory.release-hub-professional-email.v1"

	// terminalReservationLifetime is how long a cancelled or finalized
	// reservation stays as a fencing tombstone before GU-DIR-010 prunes it.
	terminalReservationLifetime = 7 * 24 * time.Hour
)

type EmailChangeOutcome struct {
	Status      int
	Reservation *directoryspec.HubAccountEmailChangeReservationResponse
	Problem     *problem.Details
}

type ProfessionalClaimOutcome struct {
	Status  int
	Claim   *directoryspec.ClaimHubProfessionalEmailResponse
	Problem *problem.Details
}

type ProfessionalReleaseOutcome struct {
	Status  int
	Release *directoryspec.ReleaseHubProfessionalEmailResponse
	Problem *problem.Details
}

type emailChangeMutation = mutation[directoryspec.HubAccountEmailChangeReservationResponse]
type professionalClaimMutation = mutation[directoryspec.ClaimHubProfessionalEmailResponse]
type professionalReleaseMutation = mutation[directoryspec.ReleaseHubProfessionalEmailResponse]

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

func (s *Service) professionalClaimCommand(
	ctx context.Context, caller directoryspec.TenantID,
	commandID directoryspec.CommandID, request any,
	work func(*sqlc.Queries) (professionalClaimMutation, *problem.Details, error),
) (ProfessionalClaimOutcome, error) {
	outcome, err := runCommand(
		ctx, s.pool, caller, claimProfessionalOperation, commandID, request, work,
	)
	return ProfessionalClaimOutcome{
		Status: outcome.status, Claim: outcome.body, Problem: outcome.problem,
	}, err
}

// ClaimHubProfessionalEmail implements GU-DIR-007. Newest proof always wins:
// the upsert always sets the requesting user as holder and bumps the
// revision, whether the previous state was absent, released, held by the
// same user, or held by someone else.
func (s *Service) ClaimHubProfessionalEmail(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.ClaimHubProfessionalEmailRequest,
) (ProfessionalClaimOutcome, error) {
	return s.professionalClaimCommand(
		ctx, caller, request.CommandID, request,
		func(q *sqlc.Queries) (professionalClaimMutation, *problem.Details, error) {
			if directoryspec.DigestKeyID(s.digestKeyID) != request.DigestKeyID {
				return professionalClaimMutation{}, details(
					coordinatorproblem.DirectoryDigestKeyMismatchError,
				), nil
			}
			did, _ := dbvalue.ParseUUID(string(request.HubUserDID))
			if rejection, err := requireActivePrincipal(ctx, q, caller, did); rejection != nil || err != nil {
				return professionalClaimMutation{}, rejection, err
			}
			digest, err := decodeDigest(request.EmailDigest)
			if err != nil {
				return professionalClaimMutation{}, nil, err
			}

			revision, err := q.InsertHubProfessionalEmailClaimIfAbsent(
				ctx, sqlc.InsertHubProfessionalEmailClaimIfAbsentParams{
					EmailDigest: digest, HubUserDid: did,
				},
			)
			if err == nil {
				return claimedProfessionalMutation(
					request.HubUserDID, revision, nil, false,
				), nil, nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return professionalClaimMutation{}, nil, fmt.Errorf(
					"insert Hub professional email claim: %w", err,
				)
			}

			locked, err := q.LockHubProfessionalEmailClaim(ctx, digest)
			if err != nil {
				return professionalClaimMutation{}, nil, fmt.Errorf(
					"lock Hub professional email claim: %w", err,
				)
			}
			revision, err = q.TransferHubProfessionalEmailClaim(
				ctx, sqlc.TransferHubProfessionalEmailClaimParams{
					EmailDigest: digest, HubUserDid: did,
				},
			)
			if err != nil {
				return professionalClaimMutation{}, nil, fmt.Errorf(
					"transfer Hub professional email claim: %w", err,
				)
			}

			transferred := locked.HubUserDid.Valid && locked.HubUserDid != did
			if !transferred {
				return claimedProfessionalMutation(
					request.HubUserDID, revision, nil, false,
				), nil, nil
			}

			var sameTenantPrevious *hub.HubUserDID
			if locked.HomeTenantID.Valid &&
				directoryspec.TenantID(locked.HomeTenantID.String) == caller {
				previous := hub.HubUserDID(dbvalue.FormatUUID(locked.HubUserDid))
				sameTenantPrevious = &previous
			} else if locked.HomeTenantID.Valid {
				if err := s.recordProfessionalEmailSupersession(
					ctx, q, locked.HomeTenantID.String, digest,
					locked.HubUserDid, revision,
				); err != nil {
					return professionalClaimMutation{}, nil, err
				}
			}
			return claimedProfessionalMutation(
				request.HubUserDID, revision, sameTenantPrevious, true,
			), nil, nil
		},
	)
}

func claimedProfessionalMutation(
	holder hub.HubUserDID, revision int64,
	sameTenantPrevious *hub.HubUserDID, transferred bool,
) professionalClaimMutation {
	return professionalClaimMutation{
		response: directoryspec.ClaimHubProfessionalEmailResponse{
			ClaimRevision:                  revision,
			SupersededSameTenantHubUserDID: sameTenantPrevious,
		},
		changed: true, skipOutbox: true,
		entityType: "hub_professional_email_claim", entityID: string(holder),
		auditAction: "global_directory.hub_professional_email_claimed",
		auditPayload: struct {
			SchemaVersion int  `json:"schema_version"`
			Transferred   bool `json:"transferred"`
		}{SchemaVersion: 1, Transferred: transferred},
	}
}

// recordProfessionalEmailSupersession allocates the previous holder's
// tenant's next feed sequence and records the supersession row, all inside
// the caller's open transaction. Sequence allocation locks the cursor row
// until commit, so visibility order equals sequence order (GU-GDB-003).
func (s *Service) recordProfessionalEmailSupersession(
	ctx context.Context, q *sqlc.Queries, previousTenant string,
	digest []byte, previousHolder pgtype.UUID, supersededByRevision int64,
) error {
	if err := q.EnsureHubProfessionalEmailFeedCursor(ctx, previousTenant); err != nil {
		return fmt.Errorf("ensure Hub professional email feed cursor: %w", err)
	}
	seq, err := q.NextHubProfessionalEmailSupersessionSeq(ctx, previousTenant)
	if err != nil {
		return fmt.Errorf("allocate Hub professional email supersession seq: %w", err)
	}
	if err := q.InsertHubProfessionalEmailSupersession(
		ctx, sqlc.InsertHubProfessionalEmailSupersessionParams{
			PreviousHomeTenantID: previousTenant, SupersessionSeq: seq,
			EmailDigest: digest, PreviousHubUserDid: previousHolder,
			SupersededByRevision: supersededByRevision,
		},
	); err != nil {
		return fmt.Errorf("insert Hub professional email supersession: %w", err)
	}
	return nil
}

// ReleaseHubProfessionalEmail implements GU-DIR-008: a stale revision or an
// address already released or reclaimed by someone else is a safe no-op.
func (s *Service) ReleaseHubProfessionalEmail(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.ReleaseHubProfessionalEmailRequest,
) (ProfessionalReleaseOutcome, error) {
	outcome, err := runCommand(
		ctx, s.pool, caller, releaseProfessionalOperation, request.CommandID,
		request,
		func(q *sqlc.Queries) (professionalReleaseMutation, *problem.Details, error) {
			did, _ := dbvalue.ParseUUID(string(request.HubUserDID))
			if rejection, err := requireActivePrincipal(ctx, q, caller, did); rejection != nil || err != nil {
				return professionalReleaseMutation{}, rejection, err
			}
			digest, err := decodeDigest(request.EmailDigest)
			if err != nil {
				return professionalReleaseMutation{}, nil, err
			}
			rows, err := q.ReleaseHubProfessionalEmailClaim(
				ctx, sqlc.ReleaseHubProfessionalEmailClaimParams{
					EmailDigest: digest, HubUserDid: did,
					ClaimRevision: request.ClaimRevision,
				},
			)
			if err != nil {
				return professionalReleaseMutation{}, nil, fmt.Errorf(
					"release Hub professional email claim: %w", err,
				)
			}
			if rows == 0 {
				return professionalReleaseMutation{
					response: directoryspec.ReleaseHubProfessionalEmailResponse{
						Released: false,
					},
				}, nil, nil
			}
			return professionalReleaseMutation{
				response: directoryspec.ReleaseHubProfessionalEmailResponse{
					Released: true,
				},
				changed: true, skipOutbox: true,
				entityType: "hub_professional_email_claim", entityID: string(request.HubUserDID),
				auditAction: "global_directory.hub_professional_email_released",
			}, nil, nil
		},
	)
	return ProfessionalReleaseOutcome{
		Status: outcome.status, Release: outcome.body, Problem: outcome.problem,
	}, err
}

// PullHubProfessionalEmailSupersessions implements GU-DIR-009. It is
// caller-scoped and naturally idempotent (it mutates only the caller's own
// cursor), so it bypasses the command ledger entirely.
func (s *Service) PullHubProfessionalEmailSupersessions(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.PullHubProfessionalEmailSupersessionsRequest,
) (directoryspec.PullHubProfessionalEmailSupersessionsResponse, *problem.Details, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return directoryspec.PullHubProfessionalEmailSupersessionsResponse{}, nil,
			fmt.Errorf("begin pull Hub professional email supersessions: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)

	cursor, err := q.LockHubProfessionalEmailFeedCursor(ctx, string(caller))
	if err != nil {
		return directoryspec.PullHubProfessionalEmailSupersessionsResponse{}, nil,
			fmt.Errorf("lock Hub professional email feed cursor: %w", err)
	}
	if request.AcknowledgedSeq > cursor.LastIssuedSeq {
		return directoryspec.PullHubProfessionalEmailSupersessionsResponse{}, details(
			coordinatorproblem.DirectoryStateConflictError,
		), nil
	}
	newAck := max(cursor.AcknowledgedSeq, request.AcknowledgedSeq)
	if err := q.AcknowledgeHubProfessionalEmailSupersessions(
		ctx, sqlc.AcknowledgeHubProfessionalEmailSupersessionsParams{
			TenantID: string(caller), AcknowledgedSeq: newAck,
		},
	); err != nil {
		return directoryspec.PullHubProfessionalEmailSupersessionsResponse{}, nil,
			fmt.Errorf("acknowledge Hub professional email supersessions: %w", err)
	}
	deleted, err := q.DeleteAcknowledgedHubProfessionalEmailSupersessions(
		ctx, sqlc.DeleteAcknowledgedHubProfessionalEmailSupersessionsParams{
			TenantID: string(caller), AcknowledgedSeq: newAck,
		},
	)
	if err != nil {
		return directoryspec.PullHubProfessionalEmailSupersessionsResponse{}, nil,
			fmt.Errorf("delete acknowledged Hub professional email supersessions: %w", err)
	}
	if deleted > 0 {
		payload, err := json.Marshal(struct {
			SchemaVersion int   `json:"schema_version"`
			Count         int64 `json:"count"`
		}{SchemaVersion: 1, Count: deleted})
		if err != nil {
			return directoryspec.PullHubProfessionalEmailSupersessionsResponse{}, nil, err
		}
		if err := q.InsertGlobalAuditEvent(ctx, sqlc.InsertGlobalAuditEventParams{
			Action:     "global_directory.hub_professional_email_supersessions_acknowledged",
			EntityType: "hub_professional_email_feed_cursor", EntityID: string(caller),
			ActorTenantID: string(caller), Payload: payload,
		}); err != nil {
			return directoryspec.PullHubProfessionalEmailSupersessionsResponse{}, nil,
				fmt.Errorf("audit Hub professional email supersession acknowledgment: %w", err)
		}
	}
	rows, err := q.ListPendingHubProfessionalEmailSupersessions(
		ctx, sqlc.ListPendingHubProfessionalEmailSupersessionsParams{
			TenantID: string(caller), AcknowledgedSeq: newAck,
			RowLimit: request.Limit,
		},
	)
	if err != nil {
		return directoryspec.PullHubProfessionalEmailSupersessionsResponse{}, nil,
			fmt.Errorf("list pending Hub professional email supersessions: %w", err)
	}
	oldest, err := q.OldestPendingHubProfessionalEmailSupersession(ctx, string(caller))
	if err != nil {
		return directoryspec.PullHubProfessionalEmailSupersessionsResponse{}, nil,
			fmt.Errorf("read oldest pending Hub professional email supersession: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return directoryspec.PullHubProfessionalEmailSupersessionsResponse{}, nil,
			fmt.Errorf("commit pull Hub professional email supersessions: %w", err)
	}

	supersessions := make(
		[]directoryspec.HubProfessionalEmailSupersession, 0, len(rows),
	)
	for _, row := range rows {
		supersessions = append(
			supersessions, directoryspec.HubProfessionalEmailSupersession{
				SupersessionSeq:      row.SupersessionSeq,
				HubUserDID:           hub.HubUserDID(dbvalue.FormatUUID(row.PreviousHubUserDid)),
				EmailDigest:          directoryspec.EmailDigest(hex.EncodeToString(row.EmailDigest)),
				SupersededByRevision: row.SupersededByRevision,
			},
		)
	}
	return directoryspec.PullHubProfessionalEmailSupersessionsResponse{
		Supersessions:          supersessions,
		AcknowledgedSeq:        newAck,
		OldestPendingCreatedAt: dbvalue.TimePtr(oldest),
	}, nil, nil
}

// CheckHubProfessionalEmailHoldings implements GU-DIR-011: every DID must be
// homed at the caller, or the whole request is rejected, and no other
// holder's DID is ever revealed.
func (s *Service) CheckHubProfessionalEmailHoldings(
	ctx context.Context, caller directoryspec.TenantID,
	request directoryspec.CheckHubProfessionalEmailHoldingsRequest,
) (directoryspec.CheckHubProfessionalEmailHoldingsResponse, *problem.Details, error) {
	dids := make([]pgtype.UUID, len(request.Items))
	digests := make([][]byte, len(request.Items))
	for i, item := range request.Items {
		dids[i], _ = dbvalue.ParseUUID(string(item.HubUserDID))
		digest, err := decodeDigest(item.EmailDigest)
		if err != nil {
			return directoryspec.CheckHubProfessionalEmailHoldingsResponse{}, nil, err
		}
		digests[i] = digest
	}
	notHomed, err := s.queries.CountHubPrincipalsNotHomedAtTenant(
		ctx, sqlc.CountHubPrincipalsNotHomedAtTenantParams{
			HubUserDids: dids, CallerTenantID: string(caller),
		},
	)
	if err != nil {
		return directoryspec.CheckHubProfessionalEmailHoldingsResponse{}, nil,
			fmt.Errorf("count Hub principals not homed at tenant: %w", err)
	}
	if notHomed > 0 {
		return directoryspec.CheckHubProfessionalEmailHoldingsResponse{}, details(
			coordinatorproblem.DirectoryCallerTenantMismatchError,
		), nil
	}
	rows, err := s.queries.CheckHubProfessionalEmailHoldings(
		ctx, sqlc.CheckHubProfessionalEmailHoldingsParams{
			HubUserDids: dids, EmailDigests: digests,
		},
	)
	if err != nil {
		return directoryspec.CheckHubProfessionalEmailHoldingsResponse{}, nil,
			fmt.Errorf("check Hub professional email holdings: %w", err)
	}
	results := make(
		[]directoryspec.HubProfessionalEmailHoldingResult, 0, len(rows),
	)
	for _, row := range rows {
		held := row.HolderHubUserDid.Valid && row.HolderHubUserDid == row.HubUserDid
		var revision *int64
		if row.HolderHubUserDid.Valid && row.ClaimRevision.Valid {
			value := row.ClaimRevision.Int64
			revision = &value
		}
		results = append(
			results, directoryspec.HubProfessionalEmailHoldingResult{
				HeldByRequestedUser: held, ClaimRevision: revision,
			},
		)
	}
	return directoryspec.CheckHubProfessionalEmailHoldingsResponse{
		Results: results,
	}, nil, nil
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
