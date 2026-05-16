package hub

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"crypto/rand"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/i18n"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	hubtypes "vetchium-api-server.typespec/hub"
)

const (
	maxWorkEmailStints = 50
	defaultListLimit   = 25
	maxListLimit       = 100
)

// generateWorkEmailCode generates a cryptographically-random 6-digit code.
func generateWorkEmailCode() (string, error) {
	max := big.NewInt(1000000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// hashEmail computes SHA-256 of the lower-cased email.
func hashEmail(email string) string {
	h := sha256.Sum256([]byte(strings.ToLower(email)))
	return hex.EncodeToString(h[:])
}

// stintToOwnerView converts a DB row to the API owner view type.
func stintToOwnerView(s regionaldb.HubEmployerStint, challenge *regionaldb.HubWorkEmailReverifyChallenge) hubtypes.WorkEmailStintOwnerView {
	v := hubtypes.WorkEmailStintOwnerView{
		StintID:      uuidToString(s.StintID),
		EmailAddress: s.EmailAddress,
		Domain:       s.Domain,
		Status:       hubtypes.WorkEmailStintStatus(s.Status),
		CreatedAt:    s.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:    s.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
	if s.FirstVerifiedAt.Valid {
		t := s.FirstVerifiedAt.Time.UTC().Format(time.RFC3339)
		v.FirstVerifiedAt = &t
	}
	if s.LastVerifiedAt.Valid {
		t := s.LastVerifiedAt.Time.UTC().Format(time.RFC3339)
		v.LastVerifiedAt = &t
	}
	if s.EndedAt.Valid {
		t := s.EndedAt.Time.UTC().Format(time.RFC3339)
		v.EndedAt = &t
	}
	if s.EndedReason.Valid {
		r := hubtypes.WorkEmailStintEndedReason(s.EndedReason.WorkEmailStintEndedReason)
		v.EndedReason = &r
	}
	if s.PendingCodeExpiresAt.Valid {
		t := s.PendingCodeExpiresAt.Time.UTC().Format(time.RFC3339)
		v.PendingCodeExpiresAt = &t
		// max 3 attempts; remaining = 3 - attempts (floor 0)
		remaining := int32(3) - s.PendingCodeAttempts
		if remaining < 0 {
			remaining = 0
		}
		v.PendingCodeAttemptsRemaining = &remaining
	}
	if challenge != nil {
		if challenge.IssuedAt.Valid {
			t := challenge.IssuedAt.Time.UTC().Format(time.RFC3339)
			v.ReverifyChallengeIssuedAt = &t
		}
		if challenge.ExpiresAt.Valid {
			t := challenge.ExpiresAt.Time.UTC().Format(time.RFC3339)
			v.ReverifyChallengeExpiresAt = &t
		}
	}
	return v
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// AddWorkEmail handles POST /hub/add-work-email
func AddWorkEmail(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.AddWorkEmailRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Normalize email
		email := strings.ToLower(strings.TrimSpace(req.EmailAddress))
		parts := strings.SplitN(email, "@", 2)
		if len(parts) != 2 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		domain := parts[1]
		emailHash := hashEmail(email)

		// Single global read: check domain blocklist
		blocked, err := s.Global.IsDomainBlocked(ctx, domain)
		if err != nil {
			log.Error("failed to check domain blocklist", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if blocked {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Generate code
		code, err := generateWorkEmailCode()
		if err != nil {
			log.Error("failed to generate code", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		codeHash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash code", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		codeExpiresAt := pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true}

		// Cross-DB write: global first, then regional
		globalEntry, err := s.Global.ClaimWorkEmailGlobal(ctx, globaldb.ClaimWorkEmailGlobalParams{
			EmailAddressHash: emailHash,
			HubUserGlobalID:  hubUser.HubUserGlobalID,
			Region:           middleware.HubRegionFromContext(ctx),
			Status:           "pending_verification",
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed to claim work email in global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		// If RETURNING is empty (no row), conflict
		if !globalEntry.HubUserGlobalID.Valid {
			// Someone already holds this email — 409
			w.WriteHeader(http.StatusConflict)
			return
		}

		// Regional tx
		var createdStint regionaldb.HubEmployerStint
		lang := i18n.Match(hubUser.PreferredLanguage)

		regionalErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Check stint cap
			count, err := qtx.CountActiveOrPendingStintsForUser(ctx, hubUser.HubUserGlobalID)
			if err != nil {
				return err
			}
			if count >= maxWorkEmailStints {
				return errStintCapReached
			}

			// Create stint
			createdStint, err = qtx.CreateWorkEmailStint(ctx, regionaldb.CreateWorkEmailStintParams{
				HubUserID:            hubUser.HubUserGlobalID,
				EmailAddress:         email,
				EmailAddressHash:     emailHash,
				Domain:               domain,
				PendingCodeHash:      pgtype.Text{String: string(codeHash), Valid: true},
				PendingCodeExpiresAt: codeExpiresAt,
			})
			if err != nil {
				return err
			}

			// Enqueue verification email
			data := templates.HubWorkEmailVerificationData{
				Code:      code,
				Domain:    domain,
				ExpiresAt: "24 hours",
			}
			_, err = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
				EmailType:     regionaldb.EmailTemplateTypeHubWorkEmailVerification,
				EmailTo:       email,
				EmailSubject:  templates.HubWorkEmailVerificationSubject(lang),
				EmailTextBody: templates.HubWorkEmailVerificationTextBody(lang, data),
				EmailHtmlBody: templates.HubWorkEmailVerificationHTMLBody(lang, data),
			})
			if err != nil {
				return err
			}

			// Audit log
			auditData, _ := json.Marshal(map[string]any{
				"stint_id":           uuidToString(createdStint.StintID),
				"email_address_hash": emailHash,
				"domain":             domain,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.add_work_email",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})

		if regionalErr != nil {
			// Compensate global claim
			if !errors.Is(regionalErr, errStintCapReached) {
				compErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
					return qtx.ReleaseWorkEmailGlobal(ctx, globaldb.ReleaseWorkEmailGlobalParams{
						EmailAddressHash: emailHash,
						HubUserGlobalID:  hubUser.HubUserGlobalID,
					})
				})
				if compErr != nil {
					log.Error("CONSISTENCY_ALERT: failed to release global work email after regional failure",
						"email_address_hash", emailHash,
						"hub_user_global_id", hubUser.HubUserGlobalID,
						"compensating_error", compErr,
						"original_error", regionalErr,
					)
				}
			}
			if errors.Is(regionalErr, errStintCapReached) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			// Handle unique constraint violations as conflicts
			if isUniqueViolation(regionalErr) {
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed regional tx for add-work-email", "error", regionalErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(hubtypes.AddWorkEmailResponse{
			StintID:              uuidToString(createdStint.StintID),
			PendingCodeExpiresAt: codeExpiresAt.Time.UTC().Format(time.RFC3339),
		})
	}
}

var errStintCapReached = errors.New("stint cap reached")

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "unique")
}

// VerifyWorkEmail handles POST /hub/verify-work-email
func VerifyWorkEmail(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.VerifyWorkEmailRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		stintUUID, err := parseUUID(req.StintID)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Single regional read to check state
		stint, err := s.RegionalForCtx(ctx).GetWorkEmailStintByID(ctx, regionaldb.GetWorkEmailStintByIDParams{
			StintID:   stintUUID,
			HubUserID: hubUser.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get stint", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if stint.Status != regionaldb.WorkEmailStintStatusPendingVerification {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		if stint.PendingCodeLockedUntil.Valid && stint.PendingCodeLockedUntil.Time.After(time.Now()) {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		if stint.PendingCodeExpiresAt.Valid && stint.PendingCodeExpiresAt.Time.Before(time.Now()) {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		if !stint.PendingCodeHash.Valid {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// bcrypt compare
		if err := bcrypt.CompareHashAndPassword([]byte(stint.PendingCodeHash.String), []byte(req.Code)); err != nil {
			// Increment attempts — in regional tx
			var updatedStint regionaldb.HubEmployerStint
			txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
				var qErr error
				updatedStint, qErr = qtx.IncrementPendingCodeAttempts(ctx, regionaldb.IncrementPendingCodeAttemptsParams{
					StintID:   stintUUID,
					HubUserID: hubUser.HubUserGlobalID,
				})
				return qErr
			})
			if txErr != nil {
				log.Error("failed to increment attempts", "error", txErr)
			}
			_ = updatedStint
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		emailHash := stint.EmailAddressHash
		domain := stint.Domain

		// Single regional tx: verify + maybe supersede + audit
		var verifiedStint regionaldb.HubEmployerStint
		var supersededStint *regionaldb.HubEmployerStint

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var err error
			verifiedStint, err = qtx.VerifyWorkEmailStint(ctx, regionaldb.VerifyWorkEmailStintParams{
				StintID:   stintUUID,
				HubUserID: hubUser.HubUserGlobalID,
			})
			if err != nil {
				return err
			}

			// Attempt supersede
			sup, supErr := qtx.SupersedePriorActiveStintAtDomain(ctx, regionaldb.SupersedePriorActiveStintAtDomainParams{
				HubUserID:          hubUser.HubUserGlobalID,
				Domain:             domain,
				SupersedingStintID: stintUUID,
			})
			if supErr != nil && !errors.Is(supErr, pgx.ErrNoRows) {
				return supErr
			}
			if supErr == nil {
				supersededStint = &sup
			}

			// Audit: verify
			auditData, _ := json.Marshal(map[string]any{
				"stint_id":           uuidToString(verifiedStint.StintID),
				"email_address_hash": emailHash,
				"domain":             domain,
				"first_verified_at":  verifiedStint.FirstVerifiedAt.Time.UTC().Format(time.RFC3339),
			})
			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.verify_work_email",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			}); err != nil {
				return err
			}

			// Audit: supersede
			if supersededStint != nil {
				supAuditData, _ := json.Marshal(map[string]any{
					"stint_id":             uuidToString(supersededStint.StintID),
					"superseding_stint_id": uuidToString(verifiedStint.StintID),
					"domain":               domain,
				})
				if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
					EventType:   "hub.supersede_work_email_stint",
					ActorUserID: hubUser.HubUserGlobalID,
					IpAddress:   audit.ExtractClientIP(r),
					EventData:   supAuditData,
				}); err != nil {
					return err
				}
			}
			return nil
		})
		if txErr != nil {
			log.Error("failed regional tx for verify-work-email", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Global: promote to active (single round-trip)
		if err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			_, err := qtx.PromoteWorkEmailGlobalToActive(ctx, globaldb.PromoteWorkEmailGlobalToActiveParams{
				EmailAddressHash: emailHash,
				HubUserGlobalID:  hubUser.HubUserGlobalID,
			})
			return err
		}); err != nil {
			log.Error("CONSISTENCY_ALERT: failed to promote work email in global DB after regional verify",
				"email_address_hash", emailHash,
				"error", err,
			)
		}

		json.NewEncoder(w).Encode(stintToOwnerView(verifiedStint, nil))
	}
}

// ResendWorkEmailCode handles POST /hub/resend-work-email-code
func ResendWorkEmailCode(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.ResendWorkEmailCodeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		stintUUID, err := parseUUID(req.StintID)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Get current state
		stint, err := s.RegionalForCtx(ctx).GetWorkEmailStintByID(ctx, regionaldb.GetWorkEmailStintByIDParams{
			StintID:   stintUUID,
			HubUserID: hubUser.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get stint", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if stint.Status != regionaldb.WorkEmailStintStatusPendingVerification {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Rate limit checks
		if stint.PendingCodeLastResentAt.Valid &&
			time.Since(stint.PendingCodeLastResentAt.Time) < time.Minute {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		if stint.PendingCodeResendsToday >= 5 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}

		// Generate new code
		code, err := generateWorkEmailCode()
		if err != nil {
			log.Error("failed to generate code", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		codeHash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash code", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		codeExpiresAt := pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true}
		lang := i18n.Match(hubUser.PreferredLanguage)

		var updatedStint regionaldb.HubEmployerStint
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var err error
			updatedStint, err = qtx.RotatePendingCode(ctx, regionaldb.RotatePendingCodeParams{
				PendingCodeHash:      pgtype.Text{String: string(codeHash), Valid: true},
				PendingCodeExpiresAt: codeExpiresAt,
				StintID:              stintUUID,
				HubUserID:            hubUser.HubUserGlobalID,
			})
			if err != nil {
				return err
			}

			data := templates.HubWorkEmailVerificationData{
				Code:      code,
				Domain:    stint.Domain,
				ExpiresAt: "24 hours",
			}
			_, err = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
				EmailType:     regionaldb.EmailTemplateTypeHubWorkEmailVerification,
				EmailTo:       stint.EmailAddress,
				EmailSubject:  templates.HubWorkEmailVerificationSubject(lang),
				EmailTextBody: templates.HubWorkEmailVerificationTextBody(lang, data),
				EmailHtmlBody: templates.HubWorkEmailVerificationHTMLBody(lang, data),
			})
			if err != nil {
				return err
			}

			auditData, _ := json.Marshal(map[string]any{
				"stint_id": uuidToString(stintUUID),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.resend_work_email_code",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if txErr != nil {
			log.Error("failed regional tx for resend-work-email-code", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(stintToOwnerView(updatedStint, nil))
	}
}

// ReverifyWorkEmail handles POST /hub/reverify-work-email
func ReverifyWorkEmail(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.ReverifyWorkEmailRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		stintUUID, err := parseUUID(req.StintID)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		stint, err := s.RegionalForCtx(ctx).GetWorkEmailStintByID(ctx, regionaldb.GetWorkEmailStintByIDParams{
			StintID:   stintUUID,
			HubUserID: hubUser.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get stint", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if stint.Status != regionaldb.WorkEmailStintStatusActive {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Check for challenge
		challenge, err := s.RegionalForCtx(ctx).GetReverifyChallenge(ctx, stintUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to get reverify challenge", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if challenge.ExpiresAt.Valid && challenge.ExpiresAt.Time.Before(time.Now()) {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(challenge.ChallengeCodeHash), []byte(req.Code)); err != nil {
			// Increment and possibly delete challenge
			txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
				updated, err := qtx.IncrementReverifyChallengeAttempts(ctx, stintUUID)
				if err != nil {
					return err
				}
				if updated.Attempts >= 3 {
					return qtx.DeleteReverifyChallenge(ctx, stintUUID)
				}
				return nil
			})
			if txErr != nil {
				log.Error("failed to increment reverify attempts", "error", txErr)
			}
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var updatedStint regionaldb.HubEmployerStint
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var err error
			updatedStint, err = qtx.ReverifyWorkEmailStint(ctx, regionaldb.ReverifyWorkEmailStintParams{
				StintID:   stintUUID,
				HubUserID: hubUser.HubUserGlobalID,
			})
			if err != nil {
				return err
			}

			if err := qtx.DeleteReverifyChallenge(ctx, stintUUID); err != nil {
				return err
			}

			auditData, _ := json.Marshal(map[string]any{
				"stint_id":         uuidToString(stintUUID),
				"last_verified_at": updatedStint.LastVerifiedAt.Time.UTC().Format(time.RFC3339),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.reverify_work_email",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if txErr != nil {
			log.Error("failed regional tx for reverify-work-email", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(stintToOwnerView(updatedStint, nil))
	}
}

// RemoveWorkEmail handles POST /hub/remove-work-email
func RemoveWorkEmail(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.RemoveWorkEmailRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		stintUUID, err := parseUUID(req.StintID)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Check ownership
		stint, err := s.RegionalForCtx(ctx).GetWorkEmailStintByID(ctx, regionaldb.GetWorkEmailStintByIDParams{
			StintID:   stintUUID,
			HubUserID: hubUser.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get stint", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var endedStint regionaldb.HubEmployerStint
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var err error
			endedStint, err = qtx.EndWorkEmailStintByUser(ctx, regionaldb.EndWorkEmailStintByUserParams{
				StintID:   stintUUID,
				HubUserID: hubUser.HubUserGlobalID,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return errAlreadyEnded
				}
				return err
			}

			// Delete any pending reverify challenge
			if err := qtx.DeleteReverifyChallenge(ctx, stintUUID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}

			endedReasonStr := ""
			if endedStint.EndedReason.Valid {
				endedReasonStr = string(endedStint.EndedReason.WorkEmailStintEndedReason)
			}
			auditData, _ := json.Marshal(map[string]any{
				"stint_id":           uuidToString(stintUUID),
				"email_address_hash": stint.EmailAddressHash,
				"domain":             stint.Domain,
				"ended_reason":       endedReasonStr,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.remove_work_email",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if txErr != nil {
			if errors.Is(txErr, errAlreadyEnded) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed regional tx for remove-work-email", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Release global entry
		if err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.ReleaseWorkEmailGlobal(ctx, globaldb.ReleaseWorkEmailGlobalParams{
				EmailAddressHash: stint.EmailAddressHash,
				HubUserGlobalID:  hubUser.HubUserGlobalID,
			})
		}); err != nil {
			log.Error("CONSISTENCY_ALERT: failed to release global work email after remove",
				"email_address_hash", stint.EmailAddressHash,
				"error", err,
			)
		}

		json.NewEncoder(w).Encode(stintToOwnerView(endedStint, nil))
	}
}

var errAlreadyEnded = errors.New("stint already ended")

// ListMyWorkEmails handles POST /hub/list-my-work-emails
func ListMyWorkEmails(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.ListMyWorkEmailsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		limit := int32(defaultListLimit)
		if req.Limit != nil && *req.Limit > 0 {
			limit = *req.Limit
			if limit > maxListLimit {
				limit = maxListLimit
			}
		}

		// Build query params
		params := regionaldb.ListMyWorkEmailStintsParams{
			HubUserID:  hubUser.HubUserGlobalID,
			LimitCount: limit + 1, // fetch one extra to detect next page
		}

		// Filter statuses
		if len(req.FilterStatus) > 0 {
			statuses := make([]string, len(req.FilterStatus))
			for i, s := range req.FilterStatus {
				statuses[i] = string(s)
			}
			params.FilterStatuses = statuses
		}

		if req.FilterDomain != nil {
			params.FilterDomain = pgtype.Text{String: *req.FilterDomain, Valid: true}
		}

		// Decode keyset cursor
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursor, err := decodeWorkEmailCursor(*req.PaginationKey)
			if err == nil {
				params.CursorStatusPriority = pgtype.Int4{Int32: cursor.statusPriority, Valid: true}
				params.CursorCreatedAt = pgtype.Timestamptz{Time: cursor.createdAt, Valid: true}
				params.CursorStintID = pgtype.UUID{Bytes: cursor.stintID, Valid: true}
			}
		}

		rows, err := s.RegionalForCtx(ctx).ListMyWorkEmailStints(ctx, params)
		if err != nil {
			log.Error("failed to list work email stints", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			k := encodeWorkEmailCursor(last)
			nextKey = &k
		}

		views := make([]hubtypes.WorkEmailStintOwnerView, len(rows))
		for i, row := range rows {
			views[i] = stintToOwnerView(row, nil)
		}

		json.NewEncoder(w).Encode(hubtypes.ListMyWorkEmailsResponse{
			WorkEmails:        views,
			NextPaginationKey: nextKey,
		})
	}
}

// GetMyWorkEmail handles POST /hub/get-my-work-email
func GetMyWorkEmail(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.GetMyWorkEmailRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		stintUUID, err := parseUUID(req.StintID)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		stint, err := s.RegionalForCtx(ctx).GetWorkEmailStintByID(ctx, regionaldb.GetWorkEmailStintByIDParams{
			StintID:   stintUUID,
			HubUserID: hubUser.HubUserGlobalID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get stint", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Fetch reverify challenge if active
		var challenge *regionaldb.HubWorkEmailReverifyChallenge
		if stint.Status == regionaldb.WorkEmailStintStatusActive {
			ch, err := s.RegionalForCtx(ctx).GetReverifyChallenge(ctx, stintUUID)
			if err == nil {
				challenge = &ch
			} else if !errors.Is(err, pgx.ErrNoRows) {
				log.Error("failed to get reverify challenge", "error", err)
			}
		}

		json.NewEncoder(w).Encode(stintToOwnerView(stint, challenge))
	}
}

// ListPublicEmployerStints handles POST /hub/list-public-employer-stints
func ListPublicEmployerStints(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.ListPublicEmployerStintsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Global read: resolve handle to region
		globalHubUser, err := s.Global.GetHubUserByHandle(ctx, req.Handle)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Unknown handle: return empty list, not 404 (avoid enumeration)
				json.NewEncoder(w).Encode(hubtypes.ListPublicEmployerStintsResponse{
					Stints: []hubtypes.PublicEmployerStint{},
				})
				return
			}
			log.Error("failed to resolve handle", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Select the home region's DB queries. No proxy.
		homeRegion := globalHubUser.HomeRegion
		homeDB := s.GetRegionalDB(homeRegion)
		if homeDB == nil {
			log.Error("no regional pool for home region", "region", homeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		rows, err := homeDB.ListPublicEmployerStintsByHandle(ctx, req.Handle)
		if err != nil {
			log.Error("failed to list public employer stints", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		stints := make([]hubtypes.PublicEmployerStint, 0, len(rows))
		for _, row := range rows {
			ps := hubtypes.PublicEmployerStint{
				Domain:    row.Domain,
				IsCurrent: row.IsCurrent,
				StartYear: row.StartYear,
			}
			if !row.IsCurrent {
				// end_year is interface{} — try to cast
				if row.EndYear != nil {
					switch v := row.EndYear.(type) {
					case int32:
						ps.EndYear = &v
					case int64:
						n := int32(v)
						ps.EndYear = &n
					case float64:
						n := int32(v)
						ps.EndYear = &n
					}
				}
			}
			stints = append(stints, ps)
		}

		json.NewEncoder(w).Encode(hubtypes.ListPublicEmployerStintsResponse{Stints: stints})
	}
}

// --- Cursor helpers ---

type workEmailCursor struct {
	statusPriority int32
	createdAt      time.Time
	stintID        [16]byte
}

func encodeWorkEmailCursor(s regionaldb.HubEmployerStint) string {
	priority := statusPriority(s.Status)
	ts := s.CreatedAt.Time.UTC().Format(time.RFC3339Nano)
	raw := fmt.Sprintf("%d|%s|%s", priority, ts, uuidToString(s.StintID))
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeWorkEmailCursor(key string) (workEmailCursor, error) {
	b, err := base64.RawURLEncoding.DecodeString(key)
	if err != nil {
		return workEmailCursor{}, err
	}
	parts := strings.SplitN(string(b), "|", 3)
	if len(parts) != 3 {
		return workEmailCursor{}, fmt.Errorf("invalid cursor")
	}
	var priority int32
	if _, err := fmt.Sscanf(parts[0], "%d", &priority); err != nil {
		return workEmailCursor{}, err
	}
	t, err := time.Parse(time.RFC3339Nano, parts[1])
	if err != nil {
		return workEmailCursor{}, err
	}
	u, err := parseUUID(parts[2])
	if err != nil {
		return workEmailCursor{}, err
	}
	return workEmailCursor{
		statusPriority: priority,
		createdAt:      t,
		stintID:        u.Bytes,
	}, nil
}

func statusPriority(s regionaldb.WorkEmailStintStatus) int32 {
	switch s {
	case regionaldb.WorkEmailStintStatusActive:
		return 0
	case regionaldb.WorkEmailStintStatusPendingVerification:
		return 1
	default:
		return 2
	}
}

func parseUUID(s string) (pgtype.UUID, error) {
	// Remove hyphens
	clean := strings.ReplaceAll(s, "-", "")
	if len(clean) != 32 {
		return pgtype.UUID{}, fmt.Errorf("invalid UUID")
	}
	b, err := hex.DecodeString(clean)
	if err != nil {
		return pgtype.UUID{}, err
	}
	var arr [16]byte
	copy(arr[:], b)
	return pgtype.UUID{Bytes: arr, Valid: true}, nil
}
