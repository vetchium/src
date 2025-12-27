package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
)

// AdminAuth is a middleware that verifies admin session tokens from the Authorization header.
// It extracts the session token, verifies it against the database, and stores the
// session and admin user in the request context for downstream handlers.
func AdminAuth(db *globaldb.Queries) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			log := LoggerFromContext(ctx, nil)

			// Get Authorization header
			auth := r.Header.Get("Authorization")
			if auth == "" {
				log.Debug("missing authorization header")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// Strip "Bearer " prefix if present
			sessionToken := auth
			if strings.HasPrefix(auth, "Bearer ") {
				sessionToken = auth[7:]
			}

			// Verify session
			session, err := db.GetAdminSession(ctx, sessionToken)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					log.Debug("invalid or expired session")
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				log.Error("failed to verify session", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Get admin user
			adminUser, err := db.GetAdminUserByID(ctx, session.AdminUserID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					log.Debug("admin user not found")
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				log.Error("failed to get admin user", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Check admin user status
			if adminUser.Status != "active" {
				log.Debug("admin user is not active", "status", adminUser.Status)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// Store session and admin user in context
			ctx = context.WithValue(ctx, adminSessionKey, session)
			ctx = context.WithValue(ctx, adminUserKey, &adminUser)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AdminSessionFromContext retrieves the admin session from the context.
// Returns zero value if not found (should only happen in tests or unauthenticated requests).
func AdminSessionFromContext(ctx context.Context) globaldb.AdminSession {
	if session, ok := ctx.Value(adminSessionKey).(globaldb.AdminSession); ok {
		return session
	}
	return globaldb.AdminSession{}
}

// AdminUserFromContext retrieves the admin user from the context.
// Returns nil if not found (should only happen in tests or unauthenticated requests).
func AdminUserFromContext(ctx context.Context) *globaldb.AdminUser {
	if user, ok := ctx.Value(adminUserKey).(*globaldb.AdminUser); ok {
		return user
	}
	return nil
}

// HubAuth is a middleware that verifies hub session tokens from the Authorization header.
// It extracts the session token, verifies it against the global database, and stores the
// session and hub user in the request context for downstream handlers.
func HubAuth(db *globaldb.Queries) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			log := LoggerFromContext(ctx, nil)

			// Get Authorization header
			auth := r.Header.Get("Authorization")
			if auth == "" {
				log.Debug("missing authorization header")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// Strip "Bearer " prefix if present
			sessionToken := auth
			if strings.HasPrefix(auth, "Bearer ") {
				sessionToken = auth[7:]
			}

			// Verify session in global DB
			session, err := db.GetHubSession(ctx, sessionToken)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					log.Debug("invalid or expired session")
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				log.Error("failed to verify session", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Get hub user from global DB
			hubUser, err := db.GetHubUserByGlobalID(ctx, session.HubUserGlobalID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					log.Debug("hub user not found")
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				log.Error("failed to get hub user", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Check hub user status
			if hubUser.Status != globaldb.HubUserStatusActive {
				log.Debug("hub user is not active", "status", hubUser.Status)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// Store session and hub user in context
			ctx = context.WithValue(ctx, hubSessionKey, session)
			ctx = context.WithValue(ctx, hubUserKey, &hubUser)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// HubSessionFromContext retrieves the hub session from the context.
// Returns zero value if not found (should only happen in tests or unauthenticated requests).
func HubSessionFromContext(ctx context.Context) globaldb.HubSession {
	if session, ok := ctx.Value(hubSessionKey).(globaldb.HubSession); ok {
		return session
	}
	return globaldb.HubSession{}
}

// HubUserFromContext retrieves the hub user from the context.
// Returns nil if not found (should only happen in tests or unauthenticated requests).
func HubUserFromContext(ctx context.Context) *globaldb.HubUser {
	if user, ok := ctx.Value(hubUserKey).(*globaldb.HubUser); ok {
		return user
	}
	return nil
}
