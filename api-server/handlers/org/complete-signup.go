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
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/org"
)

func CompleteSignup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

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

		// Proxy to correct region if needed
		if region != s.CurrentRegion {
			s.ProxyToRegion(w, r, region, bodyBytes)
			return
		}

		// Variables to capture from transaction
		var employer globaldb.Employer
		var globalUser globaldb.OrgUser

		// The employer is being created in this transaction, so this is
		// definitionally the first user for that employer.
		isFirstUser := true

		// Execute all global operations in a single transaction
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			// 1. Create employer
			var txErr error
			employer, txErr = qtx.CreateEmployer(ctx, globaldb.CreateEmployerParams{
				EmployerName: domain,
				Region:       region,
			})
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					log.Debug("employer already exists for domain", "domain", domain)
					return errors.New("employer already exists")
				}
				log.Error("failed to create employer", "error", txErr)
				return txErr
			}

			// 2. Create domain in global DB (routing only, no status)
			txErr = qtx.CreateGlobalEmployerDomain(ctx, globaldb.CreateGlobalEmployerDomainParams{
				Domain:     domain,
				Region:     region,
				EmployerID: employer.EmployerID,
			})
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					log.Debug("domain already exists", "domain", domain)
					return errors.New("domain already exists")
				}
				log.Error("failed to create global employer domain", "error", txErr)
				return txErr
			}

			// 4. Create global user (routing fields only)
			globalUser, txErr = qtx.CreateOrgUser(ctx, globaldb.CreateOrgUserParams{
				EmailAddressHash: emailHash,
				HashingAlgorithm: globaldb.EmailAddressHashingAlgorithmSHA256,
				EmployerID:       employer.EmployerID,
				HomeRegion:       region,
			})
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					log.Debug("user already exists", "email_hash", emailHash)
					return errors.New("user already exists")
				}
				log.Error("failed to create org user in global DB", "error", txErr)
				return txErr
			}

			return nil
		})

		// Handle transaction errors
		if err != nil {
			log.Error("failed global transaction", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Now all global operations succeeded atomically
		// Continue with regional operations (outside transaction boundary)

		// Hash password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", "error", err)
			// Compensating: Delete everything from global (cascades automatically)
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create regional user with full details
		_, err = s.Regional.CreateOrgUser(ctx, regionaldb.CreateOrgUserParams{
			OrgUserID:         globalUser.OrgUserID,
			EmailAddress:      email,
			EmployerID:        employer.EmployerID,
			PasswordHash:      passwordHash,
			Status:            regionaldb.OrgUserStatusActive,
			PreferredLanguage: string(req.PreferredLanguage),
			IsAdmin:           isFirstUser,
		})
		if err != nil {
			log.Error("failed to create org user in regional DB", "error", err)
			// Compensating: Delete from global (cascades)
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create verified domain in regional DB
		err = s.Regional.CreateEmployerDomain(ctx, regionaldb.CreateEmployerDomainParams{
			Domain:            domain,
			EmployerID:        employer.EmployerID,
			VerificationToken: dnsVerificationToken,
			TokenExpiresAt:    pgtype.Timestamp{Time: time.Now().AddDate(0, 0, 30), Valid: true},
			Status:            regionaldb.DomainVerificationStatusVERIFIED,
		})
		if err != nil {
			log.Error("failed to create regional employer domain", "error", err)
			// Non-critical for signup flow - domain can be re-verified later
		}

		// Assign roles if first user (now in regional DB)
		if isFirstUser {
			// Get invite_users role
			inviteRole, roleErr := s.Regional.GetRoleByName(ctx, "employer:invite_users")
			if roleErr != nil {
				if errors.Is(roleErr, pgx.ErrNoRows) {
					log.Error("invite_users role not found in regional database")
				} else {
					log.Error("failed to get invite_users role", "error", roleErr)
				}
			} else {
				// Assign invite_users role
				roleErr = s.Regional.AssignOrgUserRole(ctx, regionaldb.AssignOrgUserRoleParams{
					OrgUserID: globalUser.OrgUserID,
					RoleID:    inviteRole.RoleID,
				})
				if roleErr != nil {
					log.Error("failed to assign invite_users role", "error", roleErr)
				}
			}

			// Get manage_users role
			manageRole, roleErr := s.Regional.GetRoleByName(ctx, "employer:manage_users")
			if roleErr != nil {
				if errors.Is(roleErr, pgx.ErrNoRows) {
					log.Error("manage_users role not found in regional database")
				} else {
					log.Error("failed to get manage_users role", "error", roleErr)
				}
			} else {
				// Assign manage_users role
				roleErr = s.Regional.AssignOrgUserRole(ctx, regionaldb.AssignOrgUserRoleParams{
					OrgUserID: globalUser.OrgUserID,
					RoleID:    manageRole.RoleID,
				})
				if roleErr != nil {
					log.Error("failed to assign manage_users role", "error", roleErr)
				}
			}

			log.Info("assigned admin roles to first org user", "org_user_id", globalUser.OrgUserID)
		}

		// Generate session token
		sessionTokenBytes := make([]byte, 32)
		if _, err := rand.Read(sessionTokenBytes); err != nil {
			log.Error("failed to generate session token", "error", err)
			// Cleanup
			s.Regional.DeleteOrgUser(ctx, globalUser.OrgUserID)
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawSessionToken := hex.EncodeToString(sessionTokenBytes)

		// Add region prefix to session token
		sessionToken := tokens.AddRegionPrefix(region, rawSessionToken)

		// Create session in regional DB (raw token without prefix)
		sessionExpiresAt := pgtype.Timestamp{Time: time.Now().Add(s.TokenConfig.OrgSessionTokenExpiry), Valid: true}
		err = s.Regional.CreateOrgSession(ctx, regionaldb.CreateOrgSessionParams{
			SessionToken: rawSessionToken,
			OrgUserID:    globalUser.OrgUserID,
			ExpiresAt:    sessionExpiresAt,
		})
		if err != nil {
			log.Error("failed to create session", "error", err)
			// Cleanup
			s.Regional.DeleteOrgUser(ctx, globalUser.OrgUserID)
			s.Global.DeleteEmployer(ctx, employer.EmployerID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Mark signup token as consumed (best effort, non-critical)
		// Use the DNS verification token (signup_token) as the primary key
		_ = s.Global.MarkOrgSignupTokenConsumed(ctx, dnsVerificationToken)

		log.Info("org user signup completed via DNS verification", "org_user_id", globalUser.OrgUserID, "employer_id", employer.EmployerID, "domain", domain, "is_admin", isFirstUser)

		w.WriteHeader(http.StatusCreated)
		response := org.OrgCompleteSignupResponse{
			SessionToken: org.OrgSessionToken(sessionToken),
			OrgUserID:    globalUser.OrgUserID.String(),
		}
		json.NewEncoder(w).Encode(response)
	}
}
