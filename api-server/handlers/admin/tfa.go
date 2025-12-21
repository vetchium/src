package admin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

const (
	sessionTokenExpiry = 24 * time.Hour
)

func TFA(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var tfaRequest admin.AdminTFARequest
		if err := json.NewDecoder(r.Body).Decode(&tfaRequest); err != nil {
			s.Logger(r.Context()).Debug("failed to decode TFA request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Validate request
		if validationErrors := tfaRequest.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Lookup TFA token
		tfaTokenRecord, err := s.Global.GetAdminTFAToken(ctx, string(tfaRequest.TFAToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid or expired TFA token")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			log.Error("failed to query TFA token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify TFA code
		if tfaTokenRecord.TfaCode != string(tfaRequest.TFACode) {
			log.Debug("invalid TFA code")
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// NOTE: We intentionally do NOT delete the TFA token here.
		//
		// If we deleted the token and then session creation or response sending
		// failed, the user would be unable to retry (token gone, no session).
		// They'd have to restart the entire login flow.
		//
		// By keeping the token, the user can retry TFA verification if something
		// fails. The token expires naturally after 10 minutes, which is sufficient
		// protection. Reusing a valid token just creates another session for the
		// same authenticated user - not a security issue.

		// Generate session token
		sessionTokenBytes := make([]byte, 32)
		if _, err := rand.Read(sessionTokenBytes); err != nil {
			log.Error("failed to generate session token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		sessionToken := hex.EncodeToString(sessionTokenBytes)

		// Store session in database
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(sessionTokenExpiry), Valid: true}
		err = s.Global.CreateAdminSession(ctx, globaldb.CreateAdminSessionParams{
			SessionToken: sessionToken,
			AdminUserID:  tfaTokenRecord.AdminUserID,
			ExpiresAt:    expiresAt,
		})
		if err != nil {
			log.Error("failed to store session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("admin TFA verified, session created", "admin_user_id", tfaTokenRecord.AdminUserID)

		response := admin.AdminTFAResponse{
			SessionToken: admin.AdminSessionToken(sessionToken),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
