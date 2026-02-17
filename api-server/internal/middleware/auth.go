package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/proxy"
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
// It extracts the region-prefixed session token, and if the region doesn't match the
// current server's region, proxies the request to the correct regional server.
// Otherwise, it queries the local regional database and stores the session, hub user,
// and region in the request context.
func HubAuth(
	regionalDB *regionaldb.Queries,
	currentRegion globaldb.Region,
	internalEndpoints map[globaldb.Region]string,
) func(http.Handler) http.Handler {
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

			// Proxy to correct region if needed
			if region != currentRegion {
				endpoint, ok := internalEndpoints[region]
				if !ok {
					log.Debug("unknown region for proxy", "region", region)
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				bodyBytes, err := proxy.BufferBody(r)
				if err != nil {
					http.Error(w, "", http.StatusBadRequest)
					return
				}
				proxy.ToRegion(w, r, endpoint, bodyBytes)
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

			// Get hub user from regional DB (status, preferred_language, etc. are all regional)
			hubUser, err := regionalDB.GetHubUserByGlobalID(ctx, session.HubUserGlobalID)
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

			// Check hub user status
			if hubUser.Status != regionaldb.HubUserStatusActive {
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

// HubRegionFromContext retrieves the hub user's region from the context.
// Returns empty string if not found.
func HubRegionFromContext(ctx context.Context) string {
	if region, ok := ctx.Value(hubRegionKey).(string); ok {
		return region
	}
	return ""
}

// HubUserFromContext retrieves the hub user from the context.
// Returns nil if not found (should only happen in tests or unauthenticated requests).
func HubUserFromContext(ctx context.Context) *regionaldb.HubUser {
	if user, ok := ctx.Value(hubUserKey).(*regionaldb.HubUser); ok {
		return user
	}
	return nil
}

// OrgAuth is a middleware that verifies org session tokens from the Authorization header.
// It extracts the region-prefixed session token, and if the region doesn't match the
// current server's region, proxies the request to the correct regional server.
func OrgAuth(
	regionalDB *regionaldb.Queries,
	currentRegion globaldb.Region,
	internalEndpoints map[globaldb.Region]string,
) func(http.Handler) http.Handler {
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

			// Proxy to correct region if needed
			if region != currentRegion {
				endpoint, ok := internalEndpoints[region]
				if !ok {
					log.Debug("unknown region for proxy", "region", region)
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				bodyBytes, err := proxy.BufferBody(r)
				if err != nil {
					http.Error(w, "", http.StatusBadRequest)
					return
				}
				proxy.ToRegion(w, r, endpoint, bodyBytes)
				return
			}

			// Verify session in regional DB using raw token
			session, err := regionalDB.GetOrgSession(ctx, rawToken)
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

			// Get org user from regional DB (status, preferred_language, etc. are all regional)
			orgUser, err := regionalDB.GetOrgUserByID(ctx, session.OrgUserID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					log.Debug("org user not found in regional DB")
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				log.Error("failed to get regional org user", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Check org user status
			if orgUser.Status != regionaldb.OrgUserStatusActive {
				log.Debug("org user is not active", "status", orgUser.Status)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// Store session, org user, and region in context
			ctx = context.WithValue(ctx, orgSessionKey, session)
			ctx = context.WithValue(ctx, orgUserKey, &orgUser)
			ctx = context.WithValue(ctx, orgRegionKey, string(region))

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// OrgSessionFromContext retrieves the org session from the context.
// Returns zero value if not found (should only happen in tests or unauthenticated requests).
func OrgSessionFromContext(ctx context.Context) regionaldb.OrgSession {
	if session, ok := ctx.Value(orgSessionKey).(regionaldb.OrgSession); ok {
		return session
	}
	return regionaldb.OrgSession{}
}

// OrgUserFromContext retrieves the org user from the context.
// Returns nil if not found (should only happen in tests or unauthenticated requests).
func OrgUserFromContext(ctx context.Context) *regionaldb.OrgUser {
	if user, ok := ctx.Value(orgUserKey).(*regionaldb.OrgUser); ok {
		return user
	}
	return nil
}

// OrgRegionFromContext retrieves the org user's region from the context.
// Returns empty string if not found.
func OrgRegionFromContext(ctx context.Context) string {
	if region, ok := ctx.Value(orgRegionKey).(string); ok {
		return region
	}
	return ""
}

// AgencyAuth is a middleware that verifies agency session tokens from the Authorization header.
// It extracts the region-prefixed session token, and if the region doesn't match the
// current server's region, proxies the request to the correct regional server.
func AgencyAuth(
	regionalDB *regionaldb.Queries,
	currentRegion globaldb.Region,
	internalEndpoints map[globaldb.Region]string,
) func(http.Handler) http.Handler {
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

			// Proxy to correct region if needed
			if region != currentRegion {
				endpoint, ok := internalEndpoints[region]
				if !ok {
					log.Debug("unknown region for proxy", "region", region)
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				bodyBytes, err := proxy.BufferBody(r)
				if err != nil {
					http.Error(w, "", http.StatusBadRequest)
					return
				}
				proxy.ToRegion(w, r, endpoint, bodyBytes)
				return
			}

			// Verify session in regional DB using raw token
			session, err := regionalDB.GetAgencySession(ctx, rawToken)
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

			// Get agency user from regional DB (status, preferred_language, etc. are all regional)
			agencyUser, err := regionalDB.GetAgencyUserByID(ctx, session.AgencyUserID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					log.Debug("agency user not found in regional DB")
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				log.Error("failed to get regional agency user", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Check agency user status
			if agencyUser.Status != regionaldb.AgencyUserStatusActive {
				log.Debug("agency user is not active", "status", agencyUser.Status)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// Store session, agency user, and region in context
			ctx = context.WithValue(ctx, agencySessionKey, session)
			ctx = context.WithValue(ctx, agencyUserKey, &agencyUser)
			ctx = context.WithValue(ctx, agencyRegionKey, string(region))

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AgencySessionFromContext retrieves the agency session from the context.
// Returns zero value if not found (should only happen in tests or unauthenticated requests).
func AgencySessionFromContext(ctx context.Context) regionaldb.AgencySession {
	if session, ok := ctx.Value(agencySessionKey).(regionaldb.AgencySession); ok {
		return session
	}
	return regionaldb.AgencySession{}
}

// AgencyUserFromContext retrieves the agency user from the context.
// Returns nil if not found (should only happen in tests or unauthenticated requests).
func AgencyUserFromContext(ctx context.Context) *regionaldb.AgencyUser {
	if user, ok := ctx.Value(agencyUserKey).(*regionaldb.AgencyUser); ok {
		return user
	}
	return nil
}

// AgencyRegionFromContext retrieves the agency user's region from the context.
// Returns empty string if not found.
func AgencyRegionFromContext(ctx context.Context) string {
	if region, ok := ctx.Value(agencyRegionKey).(string); ok {
		return region
	}
	return ""
}
