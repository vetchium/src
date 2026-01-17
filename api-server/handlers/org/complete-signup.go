package org

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
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

		// Look up pending signup by email_token (proves email access)
		tokenRecord, err := s.Global.GetOrgSignupTokenByEmailToken(ctx, string(req.SignupToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("no pending signup found for token")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to query signup token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		email := tokenRecord.EmailAddress
		emailHash := tokenRecord.EmailAddressHash
		domain := tokenRecord.Domain
		region := tokenRecord.HomeRegion
		dnsVerificationToken := tokenRecord.SignupToken

		// Perform DNS TXT lookup to verify domain ownership
		var tokenFound bool

		if s.Environment == "DEV" && domain == "example.com" {
			log.Info("skipping DNS verification for example.com in DEV environment", "domain", domain)
			tokenFound = true
		} else {
			dnsRecordName := dnsRecordPrefix + domain
			txtRecords, err := net.LookupTXT(dnsRecordName)
			if err != nil {
				log.Debug("DNS lookup failed", "error", err, "record_name", dnsRecordName)
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}

			// Check if any TXT record matches the DNS verification token
			for _, record := range txtRecords {
				// TXT records may have quotes stripped or present, handle both
				cleanRecord := strings.Trim(record, "\"")
				if cleanRecord == dnsVerificationToken {
					tokenFound = true
					break
				}
			}

			if !tokenFound {
				log.Debug("DNS verification failed - token not found in TXT records", "domain", domain, "expected_token_prefix", dnsVerificationToken[:8])
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
		}

		log.Info("DNS verification successful", "domain", domain)

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

		// Create global employer domain record (marks domain as VERIFIED)
		err = s.Global.CreateGlobalEmployerDomain(ctx, globaldb.CreateGlobalEmployerDomainParams{
			Domain:     domain,
			Region:     region,
			EmployerID: employer.EmployerID,
			Status:     globaldb.DomainVerificationStatusVERIFIED,
		})
		if err != nil {
			log.Error("failed to create global employer domain", "error", err)
			// Compensating transaction: delete employer
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", "error", err)
			// Compensating transaction: delete domain and employer
			// TODO: Need to test various scenarios if any of the below things too fail
			s.Global.DeleteGlobalEmployerDomain(ctx, domain)
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
			PreferredLanguage: string(req.PreferredLanguage),
			HomeRegion:        region,
		})
		if err != nil {
			log.Error("failed to create org user in global DB", "error", err)
			// Compensating transaction: delete domain and employer
			s.Global.DeleteGlobalEmployerDomain(ctx, domain)
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create org user in regional DB (with employer_id for multi-employer support)
		_, err = regionalDB.CreateOrgUser(ctx, regionaldb.CreateOrgUserParams{
			OrgUserID:    globalUser.OrgUserID,
			EmailAddress: email,
			EmployerID:   employer.EmployerID,
			PasswordHash: passwordHash,
		})
		if err != nil {
			log.Error("failed to create org user in regional DB", "error", err)
			// Compensating transaction: delete from global
			s.Global.DeleteOrgUser(ctx, globalUser.OrgUserID)
			s.Global.DeleteGlobalEmployerDomain(ctx, domain)
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
			s.Global.DeleteGlobalEmployerDomain(ctx, domain)
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawSessionToken := hex.EncodeToString(sessionTokenBytes)

		// Add region prefix to session token
		sessionToken := tokens.AddRegionPrefix(region, rawSessionToken)

		// Create session in regional DB (raw token without prefix)
		sessionExpiresAt := pgtype.Timestamp{Time: time.Now().Add(s.TokenConfig.OrgSessionTokenExpiry), Valid: true}
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
			s.Global.DeleteGlobalEmployerDomain(ctx, domain)
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Mark signup token as consumed (best effort, non-critical)
		// Use the DNS verification token (signup_token) as the primary key
		_ = s.Global.MarkOrgSignupTokenConsumed(ctx, dnsVerificationToken)

		log.Info("org user signup completed via DNS verification", "org_user_id", globalUser.OrgUserID, "employer_id", employer.EmployerID, "domain", domain)

		w.WriteHeader(http.StatusCreated)
		response := org.OrgCompleteSignupResponse{
			SessionToken: org.OrgSessionToken(sessionToken),
			OrgUserID:    globalUser.OrgUserID.String(),
		}
		json.NewEncoder(w).Encode(response)
	}
}
