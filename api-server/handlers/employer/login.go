package employer

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
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/i18n"
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	employertypes "vetchium-api-server.typespec/employer"
)

func Login(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

		var loginRequest employertypes.OrgLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&loginRequest); err != nil {
			s.Logger(r.Context()).Debug("failed to decode login request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Validate request
		if validationErrors := loginRequest.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Look up employer by domain - must be verified
		employer, err := s.Global.GetEmployerByDomain(ctx, string(loginRequest.Domain))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("domain not found or not verified", "domain", loginRequest.Domain)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get employer by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash email to query global database
		emailHash := sha256.Sum256([]byte(loginRequest.Email))

		// Query global database for user by email hash + employer (composite lookup)
		globalUser, err := s.Global.GetOrgUserByEmailHashAndEmployer(ctx, globaldb.GetOrgUserByEmailHashAndEmployerParams{
			EmailAddressHash: emailHash[:],
			EmployerID:       employer.EmployerID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid credentials - user not found for this employer")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to query global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Proxy to correct region if needed
		if globalUser.HomeRegion != s.CurrentRegion {
			s.ProxyToRegion(w, r, globalUser.HomeRegion, bodyBytes)
			return
		}

		// Query regional database for password hash and status (composite lookup)
		regionalUser, err := s.Regional.GetOrgUserByEmailAndEmployer(ctx, regionaldb.GetOrgUserByEmailAndEmployerParams{
			EmailAddress: string(loginRequest.Email),
			EmployerID:   employer.EmployerID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid credentials - user not found in regional DB")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to query regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check user status from regional DB
		if regionalUser.Status != regionaldb.OrgUserStatusActive {
			log.Debug("disabled user")
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Verify password
		if err := bcrypt.CompareHashAndPassword(regionalUser.PasswordHash, []byte(loginRequest.Password)); err != nil {
			log.Debug("invalid credentials - password mismatch")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Generate TFA token
		tfaTokenBytes := make([]byte, 32)
		if _, err := rand.Read(tfaTokenBytes); err != nil {
			log.Error("failed to generate TFA token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawTFAToken := hex.EncodeToString(tfaTokenBytes)

		// Add region prefix to TFA token
		tfaToken := tokens.AddRegionPrefix(globalUser.HomeRegion, rawTFAToken)

		// Generate 6-digit TFA code
		tfaCode, err := generateTFACode()
		if err != nil {
			log.Error("failed to generate TFA code", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Store TFA token and enqueue email atomically
		tfaTokenExpiry := s.TokenConfig.OrgTFATokenExpiry
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(tfaTokenExpiry), Valid: true}
		lang := i18n.Match(regionalUser.PreferredLanguage)

		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
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
			log.Error("failed to create TFA token and enqueue email", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("org user login initiated, TFA email sent", "org_user_id", globalUser.OrgUserID)

		response := employertypes.OrgLoginResponse{
			TFAToken: employertypes.OrgTFAToken(tfaToken),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("JSON encoding error", "error", err)
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
	data := templates.EmployerTFAData{
		Code:    tfaCode,
		Minutes: int(tfaTokenExpiry.Minutes()),
	}

	_, err := db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     regionaldb.EmailTemplateTypeOrgTfa,
		EmailTo:       to,
		EmailSubject:  templates.EmployerTFASubject(lang),
		EmailTextBody: templates.EmployerTFATextBody(lang, data),
		EmailHtmlBody: templates.EmployerTFAHTMLBody(lang, data),
	})
	return err
}
