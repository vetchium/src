package org

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/i18n"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/common"
	orgtypes "vetchium-api-server.typespec/org"
)

func Login(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var loginRequest orgtypes.OrgLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&loginRequest); err != nil {
			s.Logger(r.Context()).Debug("failed to decode login request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		// Validate request
		if validationErrors := loginRequest.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				s.Logger(ctx).Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Look up org by domain - must be verified
		org, err := s.Global.GetOrgByDomain(ctx, string(loginRequest.Domain))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("domain not found or not verified", "domain", loginRequest.Domain)
				w.WriteHeader(http.StatusBadRequest)
				if encErr := json.NewEncoder(w).Encode([]common.ValidationError{
					{Field: "domain", Message: "Domain not found or not verified"},
				}); encErr != nil {
					s.Logger(ctx).Error("failed to encode domain error", "error", encErr)
				}
				return
			}
			s.Logger(ctx).Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash email to query global database
		emailHash := sha256.Sum256([]byte(loginRequest.Email))

		// Query global database for user by email hash + org (composite lookup)
		globalUser, err := s.Global.GetOrgUserByEmailHashAndOrg(ctx, globaldb.GetOrgUserByEmailHashAndOrgParams{
			EmailAddressHash: emailHash[:],
			OrgID:            org.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("invalid credentials - user not found for this org")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			s.Logger(ctx).Error("failed to query global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Select the home region's DB queries. No proxy.
		homeRegion := globalUser.HomeRegion
		homeDB := s.GetRegionalDB(homeRegion)
		if homeDB == nil {
			s.Logger(ctx).Error("no regional pool for home region", "region", homeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Query regional database for password hash and status (composite lookup)
		regionalUser, err := homeDB.GetOrgUserByEmailAndOrg(ctx, regionaldb.GetOrgUserByEmailAndOrgParams{
			EmailAddress: string(loginRequest.Email),
			OrgID:        org.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("invalid credentials - user not found in regional DB")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			s.Logger(ctx).Error("failed to query regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check user status from regional DB
		if regionalUser.Status != regionaldb.OrgUserStatusActive {
			s.Logger(ctx).Debug("disabled user")
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Verify password
		if err := bcrypt.CompareHashAndPassword(regionalUser.PasswordHash, []byte(loginRequest.Password)); err != nil {
			s.Logger(ctx).Debug("invalid credentials - password mismatch")
			w.WriteHeader(http.StatusUnauthorized)
			if auditErr := homeDB.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.login_failed",
				ActorUserID: regionalUser.OrgUserID,
				OrgID:       regionalUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			}); auditErr != nil {
				s.Logger(ctx).Error("failed to write login_failed audit log", "error", auditErr)
			}
			return
		}

		// Generate TFA token
		tfaTokenBytes := make([]byte, 32)
		if _, err := rand.Read(tfaTokenBytes); err != nil {
			s.Logger(ctx).Error("failed to generate TFA token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawTFAToken := hex.EncodeToString(tfaTokenBytes)

		// Add region prefix to TFA token
		tfaToken := tokens.AddRegionPrefix(globalUser.HomeRegion, rawTFAToken)

		// Generate 6-digit TFA code
		tfaCode, err := generateTFACode()
		if err != nil {
			s.Logger(ctx).Error("failed to generate TFA code", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Store TFA token and enqueue email atomically
		tfaTokenExpiry := s.TokenConfig.OrgTFATokenExpiry
		expiresAt := pgtype.Timestamptz{Time: time.Now().Add(tfaTokenExpiry), Valid: true}
		lang := i18n.Match(regionalUser.PreferredLanguage)

		err = s.WithRegionalTxFor(ctx, homeRegion, func(qtx *regionaldb.Queries) error {
			txErr := qtx.CreateOrgTFAToken(ctx, regionaldb.CreateOrgTFATokenParams{
				TfaToken:  rawTFAToken,
				OrgUserID: regionalUser.OrgUserID,
				TfaCode:   tfaCode,
				ExpiresAt: expiresAt,
			})
			if txErr != nil {
				return txErr
			}
			return sendOrgTFAEmail(ctx, qtx, regionalUser.EmailAddress, tfaCode, lang, tfaTokenExpiry)
		})
		if err != nil {
			s.Logger(ctx).Error("failed to create TFA token and enqueue email", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("org user login initiated, TFA email sent", "org_user_id", globalUser.OrgUserID)

		response := orgtypes.OrgLoginResponse{
			TFAToken: orgtypes.OrgTFAToken(tfaToken),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}

func generateTFACode() (string, error) {
	// Generate a random 6-digit code
	max := big.NewInt(1000000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func sendOrgTFAEmail(ctx context.Context, db *regionaldb.Queries, to string, tfaCode string, lang string, tfaTokenExpiry time.Duration) error {
	data := templates.OrgTFAData{
		Code:    tfaCode,
		Minutes: int(tfaTokenExpiry.Minutes()),
	}

	_, err := db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     regionaldb.EmailTemplateTypeOrgTfa,
		EmailTo:       to,
		EmailSubject:  templates.OrgTFASubject(lang),
		EmailTextBody: templates.OrgTFATextBody(lang, data),
		EmailHtmlBody: templates.OrgTFAHTMLBody(lang, data),
	})
	return err
}
