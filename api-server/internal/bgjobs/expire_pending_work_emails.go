package bgjobs

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// expirePendingWorkEmails flips all pending_verification stints whose
// pending_code_expires_at has elapsed to ended/verification_expired,
// releases the global mirror entries, and writes per-row audit logs.
func (w *RegionalWorker) expirePendingWorkEmails(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	w.log.Debug("running expire-pending-work-emails job")

	expiredStints, err := w.queries.WorkerExpirePendingStints(ctx)
	if err != nil {
		w.log.Error("failed to expire pending work email stints", "error", err)
		return
	}

	if len(expiredStints) > 0 {
		w.log.Info("expired pending work email stints", "count", len(expiredStints))
	}

	for _, stint := range expiredStints {
		stintIDStr := workEmailUUIDToStr(stint.StintID)

		// Release global mirror
		releaseErr := w.globalDB.ReleaseWorkEmailGlobal(ctx, globaldb.ReleaseWorkEmailGlobalParams{
			EmailAddressHash: stint.EmailAddressHash,
			HubUserGlobalID:  stint.HubUserID,
		})
		if releaseErr != nil {
			w.log.Error("CONSISTENCY_ALERT: failed to release global work email after pending expiry",
				"email_address_hash", stint.EmailAddressHash,
				"hub_user_id", stintIDStr,
				"error", releaseErr,
			)
		}

		// Write audit log (best-effort, no pool for tx in worker)
		auditData, _ := json.Marshal(map[string]any{
			"stint_id":           stintIDStr,
			"email_address_hash": stint.EmailAddressHash,
		})
		if auditErr := w.queries.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
			EventType: "hub.expire_work_email_pending",
			IpAddress: "worker",
			EventData: auditData,
		}); auditErr != nil {
			w.log.Error("failed to write audit log for expired pending stint",
				"stint_id", stintIDStr,
				"error", auditErr,
			)
		}
	}

	// Reset resends-today counters for stints whose last resend was > 24h ago
	if err := w.queries.ResetResendsTodayForExpiredCounters(ctx); err != nil {
		w.log.Error("failed to reset resends-today counters", "error", err)
	}
}

// manageActiveWorkEmails runs both passes:
//  1. Issue reverify challenges to stints due at last_verified_at + 365d.
//  2. End stints that exceeded the 395-day cutoff (reverify_timeout).
func (w *RegionalWorker) manageActiveWorkEmails(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}

	w.log.Debug("running manage-active-work-emails job")
	w.issueReverifyChallenges(ctx)
	w.endReverifyTimeoutStints(ctx)
}

func (w *RegionalWorker) issueReverifyChallenges(ctx context.Context) {
	stints, err := w.queries.WorkerDueForReverifyChallenge(ctx, 500)
	if err != nil {
		w.log.Error("failed to query stints due for reverify challenge", "error", err)
		return
	}
	if len(stints) == 0 {
		return
	}
	w.log.Info("issuing reverify challenges", "count", len(stints))

	for _, stint := range stints {
		if ctx.Err() != nil {
			return
		}

		stintIDStr := workEmailUUIDToStr(stint.StintID)

		code, err := workEmailGenerateSixDigitCode()
		if err != nil {
			w.log.Error("failed to generate reverify code", "stint_id", stintIDStr, "error", err)
			continue
		}

		codeHashBytes, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
		if err != nil {
			w.log.Error("failed to hash reverify code", "stint_id", stintIDStr, "error", err)
			continue
		}

		expiresAt := time.Now().Add(24 * time.Hour)

		challenge, err := w.queries.UpsertReverifyChallenge(ctx, regionaldb.UpsertReverifyChallengeParams{
			StintID:           stint.StintID,
			ChallengeCodeHash: string(codeHashBytes),
			ExpiresAt:         pgtype.Timestamptz{Time: expiresAt, Valid: true},
		})
		if err != nil {
			w.log.Error("failed to upsert reverify challenge", "stint_id", stintIDStr, "error", err)
			continue
		}

		expiresStr := challenge.ExpiresAt.Time.UTC().Format(time.RFC3339)

		// Enqueue outbox email
		subject := fmt.Sprintf("Re-verify Your Work Email at %s - Vetchium", stint.Domain)
		textBody := fmt.Sprintf(
			"Your work email at %s requires annual re-verification. Code: %s (expires %s). "+
				"Log into Vetchium and go to Settings > Work Emails to enter the code.",
			stint.Domain, code, expiresStr,
		)
		htmlBody := fmt.Sprintf(
			"<p>Your work email at <b>%s</b> requires annual re-verification to stay active.</p>"+
				"<p>Your re-verification code: <b style=\"font-family: monospace; font-size: 1.5em;\">%s</b></p>"+
				"<p>This code expires at %s.</p>"+
				"<p>Log into Vetchium and go to Settings &gt; Work Emails to enter this code.</p>",
			stint.Domain, code, expiresStr,
		)
		if _, err := w.queries.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
			EmailType:     regionaldb.EmailTemplateTypeHubWorkEmailReverifyChallenge,
			EmailTo:       stint.EmailAddress,
			EmailSubject:  subject,
			EmailTextBody: textBody,
			EmailHtmlBody: htmlBody,
		}); err != nil {
			w.log.Error("failed to enqueue reverify challenge email", "stint_id", stintIDStr, "error", err)
		}

		// Audit log
		auditData, _ := json.Marshal(map[string]any{
			"stint_id":             stintIDStr,
			"domain":               stint.Domain,
			"challenge_expires_at": expiresStr,
		})
		if auditErr := w.queries.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
			EventType: "hub.issue_work_email_reverify_challenge",
			IpAddress: "worker",
			EventData: auditData,
		}); auditErr != nil {
			w.log.Error("failed to write audit log for reverify challenge",
				"stint_id", stintIDStr,
				"error", auditErr,
			)
		}
	}
}

func (w *RegionalWorker) endReverifyTimeoutStints(ctx context.Context) {
	endedStints, err := w.queries.WorkerEndReverifyTimeoutStints(ctx)
	if err != nil {
		w.log.Error("failed to end reverify-timeout stints", "error", err)
		return
	}
	if len(endedStints) == 0 {
		return
	}
	w.log.Info("ended reverify-timeout stints", "count", len(endedStints))

	for _, stint := range endedStints {
		stintIDStr := workEmailUUIDToStr(stint.StintID)

		// Release global mirror
		releaseErr := w.globalDB.ReleaseWorkEmailGlobal(ctx, globaldb.ReleaseWorkEmailGlobalParams{
			EmailAddressHash: stint.EmailAddressHash,
			HubUserGlobalID:  stint.HubUserID,
		})
		if releaseErr != nil {
			w.log.Error("CONSISTENCY_ALERT: failed to release global work email after reverify timeout",
				"email_address_hash", stint.EmailAddressHash,
				"hub_user_id", stintIDStr,
				"error", releaseErr,
			)
		}

		lastVerifiedStr := ""
		if stint.LastVerifiedAt.Valid {
			lastVerifiedStr = stint.LastVerifiedAt.Time.UTC().Format(time.RFC3339)
		}
		auditData, _ := json.Marshal(map[string]any{
			"stint_id":         stintIDStr,
			"domain":           stint.Domain,
			"last_verified_at": lastVerifiedStr,
		})
		if auditErr := w.queries.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
			EventType: "hub.end_work_email_reverify_timeout",
			IpAddress: "worker",
			EventData: auditData,
		}); auditErr != nil {
			w.log.Error("failed to write audit log for reverify-timeout stint",
				"stint_id", stintIDStr,
				"error", auditErr,
			)
		}
	}
}

// workEmailUUIDToStr converts a pgtype.UUID to a hex string representation.
func workEmailUUIDToStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// workEmailGenerateSixDigitCode generates a cryptographically-random 6-digit code.
func workEmailGenerateSixDigitCode() (string, error) {
	max := big.NewInt(1000000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
