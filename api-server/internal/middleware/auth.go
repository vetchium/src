package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/tokens"
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
// It extracts the region-prefixed session token, queries the appropriate regional database,
// and stores the session, hub user, and region in the request context.
func HubAuth(globalDB *globaldb.Queries, getRegionalDB func(globaldb.Region) *regionaldb.Queries) func(http.Handler) http.Handler {
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
			prefixedToken := auth
			if strings.HasPrefix(auth, "Bearer ") {
				prefixedToken = auth[7:]
			}

			// Extract region from token prefix
			region, rawToken, err := tokens.ExtractRegionFromToken(prefixedToken)
			if err != nil {
				if errors.Is(err, tokens.ErrMissingPrefix) || errors.Is(err, tokens.ErrInvalidTokenFormat) {
					log.Debug("invalid session token format", "error", err)
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				if errors.Is(err, tokens.ErrUnknownRegion) {
					log.Debug("unknown region in session token", "error", err)
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				log.Error("failed to extract region from session token", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Get regional database for this region
			regionalDB := getRegionalDB(region)
			if regionalDB == nil {
				log.Error("regional database not available", "region", region)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Verify session in regional DB using raw token
			session, err := regionalDB.GetHubSession(ctx, rawToken)
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

			// Get hub user from regional DB
			regionalUser, err := regionalDB.GetHubUserByID(ctx, session.HubUserID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					log.Debug("hub user not found in regional DB")
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				log.Error("failed to get regional hub user", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Get hub user from global DB (for status, preferred_language, etc.)
			hubUser, err := globalDB.GetHubUserByGlobalID(ctx, regionalUser.HubUserGlobalID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					log.Debug("hub user not found in global DB")
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				log.Error("failed to get global hub user", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Check hub user status
			if hubUser.Status != globaldb.HubUserStatusActive {
				log.Debug("hub user is not active", "status", hubUser.Status)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// Store session, hub user, and region in context
			ctx = context.WithValue(ctx, hubSessionKey, session)
			ctx = context.WithValue(ctx, hubUserKey, &hubUser)
			ctx = context.WithValue(ctx, hubRegionKey, string(region))

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// HubSessionFromContext retrieves the hub session from the context.
// Returns zero value if not found (should only happen in tests or unauthenticated requests).
func HubSessionFromContext(ctx context.Context) regionaldb.HubSession {
	if session, ok := ctx.Value(hubSessionKey).(regionaldb.HubSession); ok {
		return session
	}
	return regionaldb.HubSession{}
}

// HubUserFromContext retrieves the hub user from the context.
// Returns nil if not found (should only happen in tests or unauthenticated requests).
func HubUserFromContext(ctx context.Context) *globaldb.HubUser {
	if user, ok := ctx.Value(hubUserKey).(*globaldb.HubUser); ok {
		return user
	}
	return nil
}
