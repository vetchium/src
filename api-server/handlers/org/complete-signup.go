package org

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/org"
)

const (
	sessionTokenExpiry = 24 * time.Hour
)

func CompleteSignup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		var req org.OrgCompleteSignupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Verify signup token
		tokenRecord, err := s.Global.GetOrgSignupToken(ctx, string(req.SignupToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid or expired signup token")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to query signup token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Use email from token record (already verified when token was created)
		email := tokenRecord.EmailAddress
		emailHash := tokenRecord.EmailAddressHash

		// Check if email already registered (duplicate signup during token lifetime)
		_, err = s.Global.GetOrgUserByEmailHash(ctx, emailHash)
		if err == nil {
			log.Debug("email already registered")
			w.WriteHeader(http.StatusConflict)
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to query user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Extract domain from email to use as employer name
		parts := strings.Split(email, "@")
		if len(parts) != 2 {
			log.Debug("invalid email format in token")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		domain := strings.ToLower(parts[1])

		// Use region from signup token (user selected during init-signup)
		region := tokenRecord.HomeRegion

		// Get regional DB for the current region
		regionalDB := s.GetRegionalDB(region)
		if regionalDB == nil {
			log.Error("regional database not available", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create employer first
		employer, err := s.Global.CreateEmployer(ctx, globaldb.CreateEmployerParams{
			EmployerName: domain, // Use domain as initial employer name
			Region:       region,
		})
		if err != nil {
			log.Error("failed to create employer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", "error", err)
			// Compensating transaction: delete employer
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create org user in global DB
		globalUser, err := s.Global.CreateOrgUser(ctx, globaldb.CreateOrgUserParams{
			EmailAddressHash:  emailHash,
			HashingAlgorithm:  globaldb.EmailAddressHashingAlgorithmSHA256,
			EmployerID:        employer.EmployerID,
			Status:            globaldb.OrgUserStatusActive,
			PreferredLanguage: "en-US",
			HomeRegion:        region,
		})
		if err != nil {
			log.Error("failed to create org user in global DB", "error", err)
			// Compensating transaction: delete employer
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create org user in regional DB
		_, err = regionalDB.CreateOrgUser(ctx, regionaldb.CreateOrgUserParams{
			OrgUserID:    globalUser.OrgUserID,
			EmailAddress: email,
			PasswordHash: passwordHash,
		})
		if err != nil {
			log.Error("failed to create org user in regional DB", "error", err)
			// Compensating transaction: delete from global
			s.Global.DeleteOrgUser(ctx, globalUser.OrgUserID)
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate session token
		sessionTokenBytes := make([]byte, 32)
		if _, err := rand.Read(sessionTokenBytes); err != nil {
			log.Error("failed to generate session token", "error", err)
			// Cleanup
			regionalDB.DeleteOrgUser(ctx, globalUser.OrgUserID)
			s.Global.DeleteOrgUser(ctx, globalUser.OrgUserID)
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawSessionToken := hex.EncodeToString(sessionTokenBytes)

		// Add region prefix to session token
		sessionToken := tokens.AddRegionPrefix(region, rawSessionToken)

		// Create session in regional DB (raw token without prefix)
		sessionExpiresAt := pgtype.Timestamp{Time: time.Now().Add(sessionTokenExpiry), Valid: true}
		err = regionalDB.CreateOrgSession(ctx, regionaldb.CreateOrgSessionParams{
			SessionToken: rawSessionToken,
			OrgUserID:    globalUser.OrgUserID,
			ExpiresAt:    sessionExpiresAt,
		})
		if err != nil {
			log.Error("failed to create session", "error", err)
			// Cleanup
			regionalDB.DeleteOrgUser(ctx, globalUser.OrgUserID)
			s.Global.DeleteOrgUser(ctx, globalUser.OrgUserID)
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Mark signup token as consumed (best effort, non-critical)
		_ = s.Global.MarkOrgSignupTokenConsumed(ctx, string(req.SignupToken))

		log.Info("org user signup completed", "org_user_id", globalUser.OrgUserID, "employer_id", employer.EmployerID)

		w.WriteHeader(http.StatusCreated)
		response := org.OrgCompleteSignupResponse{
			SessionToken: org.OrgSessionToken(sessionToken),
			OrgUserID:    globalUser.OrgUserID.String(),
		}
		json.NewEncoder(w).Encode(response)
	}
}
