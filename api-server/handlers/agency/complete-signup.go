package agency

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
	"vetchium-api-server.typespec/agency"
)

func CompleteSignup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		var req agency.AgencyCompleteSignupRequest
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
		tokenRecord, err := s.Global.GetAgencySignupTokenByEmailToken(ctx, string(req.SignupToken))
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

		// Variables to capture from transaction
		var agencyEntity globaldb.Agency
		var globalUser globaldb.AgencyUser

		// Execute all global operations in a single transaction
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			// 1. Create agency
			var txErr error
			agencyEntity, txErr = qtx.CreateAgency(ctx, globaldb.CreateAgencyParams{
				AgencyName: domain,
				Region:     region,
			})
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					log.Debug("agency already exists for domain", "domain", domain)
					return errors.New("agency already exists")
				}
				log.Error("failed to create agency", "error", txErr)
				return txErr
			}

			// 2. Create domain (no Status field in global)
			txErr = qtx.CreateGlobalAgencyDomain(ctx, globaldb.CreateGlobalAgencyDomainParams{
				Domain:   domain,
				Region:   region,
				AgencyID: agencyEntity.AgencyID,
			})
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					log.Debug("domain already exists", "domain", domain)
					return errors.New("domain already exists")
				}
				log.Error("failed to create global agency domain", "error", txErr)
				return txErr
			}

			// 3. Create global user (routing data only)
			globalUser, txErr = qtx.CreateAgencyUser(ctx, globaldb.CreateAgencyUserParams{
				EmailAddressHash: emailHash,
				HashingAlgorithm: globaldb.EmailAddressHashingAlgorithmSHA256,
				AgencyID:         agencyEntity.AgencyID,
				HomeRegion:       region,
			})
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					log.Debug("user already exists", "email_hash", emailHash)
					return errors.New("user already exists")
				}
				log.Error("failed to create agency user in global DB", "error", txErr)
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
			s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if first user for this agency in regional DB
		userCount, err := regionalDB.CountAgencyUsersByAgency(ctx, agencyEntity.AgencyID)
		if err != nil {
			log.Error("failed to count agency users", "error", err)
			s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		isFirstUser := userCount == 0

		// Create regional user with full data
		_, err = regionalDB.CreateAgencyUser(ctx, regionaldb.CreateAgencyUserParams{
			AgencyUserID:      globalUser.AgencyUserID,
			EmailAddress:      email,
			AgencyID:          agencyEntity.AgencyID,
			PasswordHash:      passwordHash,
			Status:            regionaldb.AgencyUserStatusActive,
			PreferredLanguage: string(req.PreferredLanguage),
			IsAdmin:           isFirstUser,
		})
		if err != nil {
			log.Error("failed to create agency user in regional DB", "error", err)
			// Compensating: Delete from global (cascades)
			s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Assign roles if first user (in regional DB)
		if isFirstUser {
			// Get invite_users role
			inviteRole, roleErr := regionalDB.GetRoleByName(ctx, "agency:invite_users")
			if roleErr != nil {
				if errors.Is(roleErr, pgx.ErrNoRows) {
					log.Error("invite_users role not found in database")
				} else {
					log.Error("failed to get invite_users role", "error", roleErr)
				}
				// Cleanup
				regionalDB.DeleteAgencyUser(ctx, globalUser.AgencyUserID)
				s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Assign invite_users role
			roleErr = regionalDB.AssignAgencyUserRole(ctx, regionaldb.AssignAgencyUserRoleParams{
				AgencyUserID: globalUser.AgencyUserID,
				RoleID:       inviteRole.RoleID,
			})
			if roleErr != nil {
				log.Error("failed to assign invite_users role", "error", roleErr)
				regionalDB.DeleteAgencyUser(ctx, globalUser.AgencyUserID)
				s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Get manage_users role
			manageRole, roleErr := regionalDB.GetRoleByName(ctx, "agency:manage_users")
			if roleErr != nil {
				if errors.Is(roleErr, pgx.ErrNoRows) {
					log.Error("manage_users role not found in database")
				} else {
					log.Error("failed to get manage_users role", "error", roleErr)
				}
				// Cleanup
				regionalDB.DeleteAgencyUser(ctx, globalUser.AgencyUserID)
				s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Assign manage_users role
			roleErr = regionalDB.AssignAgencyUserRole(ctx, regionaldb.AssignAgencyUserRoleParams{
				AgencyUserID: globalUser.AgencyUserID,
				RoleID:       manageRole.RoleID,
			})
			if roleErr != nil {
				log.Error("failed to assign manage_users role", "error", roleErr)
				regionalDB.DeleteAgencyUser(ctx, globalUser.AgencyUserID)
				s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			log.Info("assigned admin roles to first agency user", "agency_user_id", globalUser.AgencyUserID)
		}

		// Generate session token
		sessionTokenBytes := make([]byte, 32)
		if _, err := rand.Read(sessionTokenBytes); err != nil {
			log.Error("failed to generate session token", "error", err)
			// Cleanup
			regionalDB.DeleteAgencyUser(ctx, globalUser.AgencyUserID)
			s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawSessionToken := hex.EncodeToString(sessionTokenBytes)

		// Add region prefix to session token
		sessionToken := tokens.AddRegionPrefix(region, rawSessionToken)

		// Create session in regional DB (raw token without prefix)
		sessionExpiresAt := pgtype.Timestamp{Time: time.Now().Add(s.TokenConfig.OrgSessionTokenExpiry), Valid: true}
		err = regionalDB.CreateAgencySession(ctx, regionaldb.CreateAgencySessionParams{
			SessionToken: rawSessionToken,
			AgencyUserID: globalUser.AgencyUserID,
			ExpiresAt:    sessionExpiresAt,
		})
		if err != nil {
			log.Error("failed to create session", "error", err)
			// Cleanup
			regionalDB.DeleteAgencyUser(ctx, globalUser.AgencyUserID)
			s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Mark signup token as consumed (best effort, non-critical)
		// Use the DNS verification token (signup_token) as the primary key
		_ = s.Global.MarkAgencySignupTokenConsumed(ctx, dnsVerificationToken)

		log.Info("agency user signup completed via DNS verification", "agency_user_id", globalUser.AgencyUserID, "agency_id", agencyEntity.AgencyID, "domain", domain, "is_admin", isFirstUser)

		w.WriteHeader(http.StatusCreated)
		response := agency.AgencyCompleteSignupResponse{
			SessionToken: agency.AgencySessionToken(sessionToken),
			AgencyUserID: globalUser.AgencyUserID.String(),
		}
		json.NewEncoder(w).Encode(response)
	}
}
