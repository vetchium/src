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
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/agency"
)

func CompleteSignup(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		var req agency.AgencyCompleteSignupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Look up pending signup by email_token (proves email access)
		tokenRecord, err := s.Global.GetAgencySignupTokenByEmailToken(ctx, string(req.SignupToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("no pending signup found for token")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to query signup token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		email := tokenRecord.EmailAddress
		emailHash := tokenRecord.EmailAddressHash
		domain := tokenRecord.Domain
		region := tokenRecord.HomeRegion
		dnsVerificationToken := tokenRecord.SignupToken

		// Proxy to correct region if needed
		if region != s.CurrentRegion {
			s.ProxyToRegion(w, r, region, bodyBytes)
			return
		}

		// Perform DNS TXT lookup to verify domain ownership
		var tokenFound bool

		if s.Environment == "DEV" && (domain == "example.com" || strings.HasSuffix(domain, ".example.com")) {
			s.Logger(ctx).Info("skipping DNS verification for example.com in DEV environment", "domain", domain)
			tokenFound = true
		} else {
			dnsRecordName := dnsRecordPrefix + domain
			txtRecords, err := net.LookupTXT(dnsRecordName)
			if err != nil {
				s.Logger(ctx).Debug("DNS lookup failed", "error", err, "record_name", dnsRecordName)
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
				s.Logger(ctx).Debug("DNS verification failed - token not found in TXT records", "domain", domain, "expected_token_prefix", dnsVerificationToken[:8])
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
		}

		s.Logger(ctx).Info("DNS verification successful", "domain", domain)

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
					s.Logger(ctx).Debug("agency already exists for domain", "domain", domain)
					return errors.New("agency already exists")
				}
				s.Logger(ctx).Error("failed to create agency", "error", txErr)
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
					s.Logger(ctx).Debug("domain already exists", "domain", domain)
					return errors.New("domain already exists")
				}
				s.Logger(ctx).Error("failed to create global agency domain", "error", txErr)
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
					s.Logger(ctx).Debug("user already exists", "email_hash", emailHash)
					return errors.New("user already exists")
				}
				s.Logger(ctx).Error("failed to create agency user in global DB", "error", txErr)
				return txErr
			}

			return nil
		})

		// Handle transaction errors
		if err != nil {
			s.Logger(ctx).Error("failed global transaction", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash password (expensive CPU op, done outside DB transactions)
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			s.Logger(ctx).Error("failed to hash password", "error", err)
			s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate session token (crypto, done outside DB transaction)
		sessionTokenBytes := make([]byte, 32)
		if _, err := rand.Read(sessionTokenBytes); err != nil {
			s.Logger(ctx).Error("failed to generate session token", "error", err)
			s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawSessionToken := hex.EncodeToString(sessionTokenBytes)
		sessionToken := tokens.AddRegionPrefix(region, rawSessionToken)

		// Execute all regional operations in a single transaction.
		// The agency is always newly created above, so this is definitionally
		// the first user — assign the superadmin role unconditionally.
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// 1. Create regional user with full data
			_, txErr := qtx.CreateAgencyUser(ctx, regionaldb.CreateAgencyUserParams{
				AgencyUserID:      globalUser.AgencyUserID,
				EmailAddress:      email,
				AgencyID:          agencyEntity.AgencyID,
				PasswordHash:      passwordHash,
				Status:            regionaldb.AgencyUserStatusActive,
				PreferredLanguage: string(req.PreferredLanguage),
			})
			if txErr != nil {
				s.Logger(ctx).Error("failed to create agency user in regional DB", "error", txErr)
				return txErr
			}

			// 2. Create verified domain in regional DB
			now := time.Now()
			txErr = qtx.CreateAgencyDomain(ctx, regionaldb.CreateAgencyDomainParams{
				Domain:            domain,
				AgencyID:          agencyEntity.AgencyID,
				VerificationToken: dnsVerificationToken,
				TokenExpiresAt:    pgtype.Timestamptz{Time: now.AddDate(0, 0, 30), Valid: true},
				Status:            regionaldb.DomainVerificationStatusVERIFIED,
				LastVerifiedAt:    pgtype.Timestamptz{Time: now, Valid: true},
			})
			if txErr != nil {
				s.Logger(ctx).Error("failed to create regional agency domain", "error", txErr)
				return txErr
			}

			// 3. Assign superadmin role to first user (agency always newly created)
			superadminRole, txErr := qtx.GetRoleByName(ctx, "agency:superadmin")
			if txErr != nil {
				s.Logger(ctx).Error("failed to get agency:superadmin role", "error", txErr)
				return txErr
			}
			txErr = qtx.AssignAgencyUserRole(ctx, regionaldb.AssignAgencyUserRoleParams{
				AgencyUserID: globalUser.AgencyUserID,
				RoleID:       superadminRole.RoleID,
			})
			if txErr != nil {
				s.Logger(ctx).Error("failed to assign agency:superadmin role", "error", txErr)
				return txErr
			}

			// 3. Create session (note comment above says "3." but this is actually step 4)
			sessionExpiresAt := pgtype.Timestamptz{Time: time.Now().Add(s.TokenConfig.OrgSessionTokenExpiry), Valid: true}
			txErr = qtx.CreateAgencySession(ctx, regionaldb.CreateAgencySessionParams{
				SessionToken: rawSessionToken,
				AgencyUserID: globalUser.AgencyUserID,
				ExpiresAt:    sessionExpiresAt,
			})
			if txErr != nil {
				s.Logger(ctx).Error("failed to create session", "error", txErr)
				return txErr
			}

			// Write audit log
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "agency.complete_signup",
				ActorUserID: globalUser.AgencyUserID,
				OrgID:       agencyEntity.AgencyID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		})
		if err != nil {
			// Compensating: delete from global (cascades to global user/domain)
			s.Global.DeleteAgency(ctx, agencyEntity.AgencyID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Mark signup token as consumed (best effort, non-critical)
		_ = s.Global.MarkAgencySignupTokenConsumed(ctx, dnsVerificationToken)

		s.Logger(ctx).Info("agency user signup completed via DNS verification", "agency_user_id", globalUser.AgencyUserID, "agency_id", agencyEntity.AgencyID, "domain", domain)

		w.WriteHeader(http.StatusCreated)
		response := agency.AgencyCompleteSignupResponse{
			SessionToken: agency.AgencySessionToken(sessionToken),
			AgencyUserID: globalUser.AgencyUserID.String(),
		}
		json.NewEncoder(w).Encode(response)
	}
}
