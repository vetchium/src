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
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	orgtypes "vetchium-api-server.typespec/org"
)

func CompleteSignup(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		var req orgtypes.OrgCompleteSignupRequest
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
		tokenRecord, err := s.Global.GetOrgSignupTokenByEmailToken(ctx, string(req.SignupToken))
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

		// Perform DNS TXT lookup to verify domain ownership
		var tokenFound bool

		if s.Environment == "DEV" && (domain == "example.com" || strings.HasSuffix(domain, ".example.com") || strings.HasSuffix(domain, ".example")) {
			s.Logger(ctx).Info("skipping DNS verification for reserved domain in DEV environment", "domain", domain)
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

		// Select the home region's DB queries. No proxy.
		homeDB := s.GetRegionalDB(region)
		if homeDB == nil {
			s.Logger(ctx).Error("no regional pool for home region", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Variables to capture from transaction
		var newOrg globaldb.Org
		var globalUser globaldb.OrgUser

		// Execute all global operations in a single transaction
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			// 1. Create newOrg
			var txErr error
			newOrg, txErr = qtx.CreateOrg(ctx, globaldb.CreateOrgParams{
				OrgName: domain,
				Region:  region,
			})
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					s.Logger(ctx).Debug("org already exists for domain", "domain", domain)
					return errors.New("org already exists")
				}
				s.Logger(ctx).Error("failed to create org", "error", txErr)
				return txErr
			}

			// 2. Create domain in global DB (routing only, no status)
			txErr = qtx.CreateGlobalOrgDomain(ctx, globaldb.CreateGlobalOrgDomainParams{
				Domain:    domain,
				Region:    region,
				OrgID:     newOrg.OrgID,
				IsPrimary: true,
			})
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					s.Logger(ctx).Debug("domain already exists", "domain", domain)
					return errors.New("domain already exists")
				}
				s.Logger(ctx).Error("failed to create global org domain", "error", txErr)
				return txErr
			}

			// 3. Create global user (routing fields only)
			globalUser, txErr = qtx.CreateOrgUser(ctx, globaldb.CreateOrgUserParams{
				EmailAddressHash: emailHash,
				HashingAlgorithm: globaldb.EmailAddressHashingAlgorithmSHA256,
				OrgID:            newOrg.OrgID,
				HomeRegion:       region,
			})
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					s.Logger(ctx).Debug("user already exists", "email_hash", emailHash)
					return errors.New("user already exists")
				}
				s.Logger(ctx).Error("failed to create org user in global DB", "error", txErr)
				return txErr
			}

			// 4. Assign free plan on signup
			txErr = qtx.UpsertOrgPlan(ctx, globaldb.UpsertOrgPlanParams{
				OrgID:              newOrg.OrgID,
				CurrentPlanID:      "free",
				UpdatedByAdminID:   pgtype.UUID{Valid: false},
				UpdatedByOrgUserID: pgtype.UUID{Valid: false},
				Note:               "",
			})
			if txErr != nil {
				s.Logger(ctx).Error("failed to create org plan", "error", txErr)
				return txErr
			}
			txErr = qtx.InsertOrgPlanHistory(ctx, globaldb.InsertOrgPlanHistoryParams{
				OrgID:              newOrg.OrgID,
				FromPlanID:         pgtype.Text{Valid: false},
				ToPlanID:           "free",
				ChangedByAdminID:   pgtype.UUID{Valid: false},
				ChangedByOrgUserID: pgtype.UUID{Valid: false},
				Reason:             "signup",
			})
			if txErr != nil {
				s.Logger(ctx).Error("failed to insert org plan history", "error", txErr)
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
			s.Global.DeleteOrg(ctx, newOrg.OrgID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate session token (crypto, done outside DB transaction)
		sessionTokenBytes := make([]byte, 32)
		if _, err := rand.Read(sessionTokenBytes); err != nil {
			s.Logger(ctx).Error("failed to generate session token", "error", err)
			s.Global.DeleteOrg(ctx, newOrg.OrgID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawSessionToken := hex.EncodeToString(sessionTokenBytes)
		sessionToken := tokens.AddRegionPrefix(region, rawSessionToken)

		// Execute all regional operations in a single transaction.
		// The org is always newly created above, so this is definitionally
		// the first user — assign the superadmin role unconditionally.
		err = s.WithRegionalTxFor(ctx, region, func(qtx *regionaldb.Queries) error {
			// 1. Create regional user with full details
			_, txErr := qtx.CreateOrgUser(ctx, regionaldb.CreateOrgUserParams{
				OrgUserID:         globalUser.OrgUserID,
				EmailAddress:      email,
				OrgID:             newOrg.OrgID,
				PasswordHash:      passwordHash,
				Status:            regionaldb.OrgUserStatusActive,
				PreferredLanguage: string(req.PreferredLanguage),
			})
			if txErr != nil {
				s.Logger(ctx).Error("failed to create org user in regional DB", "error", txErr)
				return txErr
			}

			// 2. Create verified domain in regional DB
			now := time.Now()
			txErr = qtx.CreateOrgDomain(ctx, regionaldb.CreateOrgDomainParams{
				Domain:            domain,
				OrgID:             newOrg.OrgID,
				VerificationToken: dnsVerificationToken,
				TokenExpiresAt:    pgtype.Timestamptz{Time: now.AddDate(0, 0, 30), Valid: true},
				Status:            regionaldb.DomainVerificationStatusVERIFIED,
				LastVerifiedAt:    pgtype.Timestamptz{Time: now, Valid: true},
			})
			if txErr != nil {
				s.Logger(ctx).Error("failed to create regional org domain", "error", txErr)
				return txErr
			}

			// 3. Assign superadmin role to first user
			superadminRole, txErr := qtx.GetRoleByName(ctx, "org:superadmin")
			if txErr != nil {
				s.Logger(ctx).Error("failed to get org:superadmin role", "error", txErr)
				return txErr
			}
			txErr = qtx.AssignOrgUserRole(ctx, regionaldb.AssignOrgUserRoleParams{
				OrgUserID: globalUser.OrgUserID,
				RoleID:    superadminRole.RoleID,
			})
			if txErr != nil {
				s.Logger(ctx).Error("failed to assign org:superadmin role", "error", txErr)
				return txErr
			}

			// 4. Create session
			sessionExpiresAt := pgtype.Timestamptz{Time: time.Now().Add(s.TokenConfig.OrgSessionTokenExpiry), Valid: true}
			txErr = qtx.CreateOrgSession(ctx, regionaldb.CreateOrgSessionParams{
				SessionToken: rawSessionToken,
				OrgUserID:    globalUser.OrgUserID,
				ExpiresAt:    sessionExpiresAt,
			})
			if txErr != nil {
				s.Logger(ctx).Error("failed to create session", "error", txErr)
				return txErr
			}

			// 5. Write audit log
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.complete_signup",
				ActorUserID: globalUser.OrgUserID,
				OrgID:       newOrg.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		})
		if err != nil {
			// Compensating: delete from global (cascades to global user/domain)
			s.Global.DeleteOrg(ctx, newOrg.OrgID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Mark signup token as consumed (best effort, non-critical)
		_ = s.Global.MarkOrgSignupTokenConsumed(ctx, dnsVerificationToken)

		s.Logger(ctx).Info("org user signup completed via DNS verification", "org_user_id", globalUser.OrgUserID, "org_id", newOrg.OrgID, "domain", domain)

		w.WriteHeader(http.StatusCreated)
		response := orgtypes.OrgCompleteSignupResponse{
			SessionToken: orgtypes.OrgSessionToken(sessionToken),
		}
		json.NewEncoder(w).Encode(response)
	}
}
