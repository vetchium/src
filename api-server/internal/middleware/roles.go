package middleware

import (
	"net/http"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// AdminRole checks if the authenticated admin user has ANY of the required roles.
// If no roles are specified, only authentication is required (any authenticated admin can access).
// Returns 403 if user lacks all required roles.
// Must be chained after AdminAuth middleware.
func AdminRole(globalDB *globaldb.Queries, requiredRoles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			ctx := r.Context()

			// Get admin user from context (set by AdminAuth)
			adminUser := AdminUserFromContext(ctx)
			if adminUser == nil {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// If no roles specified, allow access (auth-only)
			if len(requiredRoles) == 0 {
				next.ServeHTTP(w, r)
				return
			}

			// Check if user has ANY of the required roles
			for _, requiredRole := range requiredRoles {
				role, err := globalDB.GetRoleByName(ctx, requiredRole)
				if err != nil {
					// Role doesn't exist in DB, skip to next role
					continue
				}

				hasRole, err := globalDB.HasAdminUserRole(ctx, globaldb.HasAdminUserRoleParams{
					AdminUserID: adminUser.AdminUserID,
					RoleID:      role.RoleID,
				})
				if err != nil {
					// Error checking role, skip to next role
					continue
				}

				if hasRole {
					// User has this role, allow access
					next.ServeHTTP(w, r)
					return
				}
			}

			// User doesn't have any of the required roles
			w.WriteHeader(http.StatusForbidden)
		})
	}
}

// EmployerRole checks if the authenticated employer user has ANY of the required roles.
// If user.IsAdmin == true, bypass role check and allow access.
// If no roles are specified, only authentication is required (any authenticated employer can access).
// Returns 403 if not admin and lacks all required roles.
// Must be chained after OrgAuth middleware.
func EmployerRole(globalDB *globaldb.Queries, getRegionalDB func(globaldb.Region) *regionaldb.Queries, requiredRoles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			ctx := r.Context()

			// Get org user from context (set by OrgAuth)
			orgUser := OrgUserFromContext(ctx)
			if orgUser == nil {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// IsAdmin bypass: admins can access everything
			if orgUser.IsAdmin {
				next.ServeHTTP(w, r)
				return
			}

			// If no roles specified, allow access (auth-only)
			if len(requiredRoles) == 0 {
				next.ServeHTTP(w, r)
				return
			}

			// Check if user has ANY of the required roles
			for _, requiredRole := range requiredRoles {
				role, err := globalDB.GetRoleByName(ctx, requiredRole)
				if err != nil {
					// Role doesn't exist in DB, skip to next role
					continue
				}

				hasRole, err := globalDB.HasOrgUserRole(ctx, globaldb.HasOrgUserRoleParams{
					OrgUserID: orgUser.OrgUserID,
					RoleID:    role.RoleID,
				})
				if err != nil {
					// Error checking role, skip to next role
					continue
				}

				if hasRole {
					// User has this role, allow access
					next.ServeHTTP(w, r)
					return
				}
			}

			// User doesn't have any of the required roles
			w.WriteHeader(http.StatusForbidden)
		})
	}
}

// AgencyRole checks if the authenticated agency user has ANY of the required roles.
// If user.IsAdmin == true, bypass role check and allow access.
// If no roles are specified, only authentication is required (any authenticated agency user can access).
// Returns 403 if not admin and lacks all required roles.
// Must be chained after AgencyAuth middleware.
func AgencyRole(globalDB *globaldb.Queries, getRegionalDB func(globaldb.Region) *regionaldb.Queries, requiredRoles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			ctx := r.Context()

			// Get agency user from context (set by AgencyAuth)
			agencyUser := AgencyUserFromContext(ctx)
			if agencyUser == nil {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// IsAdmin bypass: admins can access everything
			if agencyUser.IsAdmin {
				next.ServeHTTP(w, r)
				return
			}

			// If no roles specified, allow access (auth-only)
			if len(requiredRoles) == 0 {
				next.ServeHTTP(w, r)
				return
			}

			// Check if user has ANY of the required roles
			for _, requiredRole := range requiredRoles {
				role, err := globalDB.GetRoleByName(ctx, requiredRole)
				if err != nil {
					// Role doesn't exist in DB, skip to next role
					continue
				}

				hasRole, err := globalDB.HasAgencyUserRole(ctx, globaldb.HasAgencyUserRoleParams{
					AgencyUserID: agencyUser.AgencyUserID,
					RoleID:       role.RoleID,
				})
				if err != nil {
					// Error checking role, skip to next role
					continue
				}

				if hasRole {
					// User has this role, allow access
					next.ServeHTTP(w, r)
					return
				}
			}

			// User doesn't have any of the required roles
			w.WriteHeader(http.StatusForbidden)
		})
	}
}

// EmployerAdminOnly restricts access to employer users with IsAdmin == true.
// Returns 403 if user is not an admin.
// Must be chained after OrgAuth middleware.
func EmployerAdminOnly(globalDB *globaldb.Queries) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			ctx := r.Context()

			// Get org user from context (set by OrgAuth)
			orgUser := OrgUserFromContext(ctx)
			if orgUser == nil {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// Check IsAdmin flag
			if !orgUser.IsAdmin {
				w.WriteHeader(http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// AgencyAdminOnly restricts access to agency users with IsAdmin == true.
// Returns 403 if user is not an admin.
// Must be chained after AgencyAuth middleware.
func AgencyAdminOnly(globalDB *globaldb.Queries) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			ctx := r.Context()

			// Get agency user from context (set by AgencyAuth)
			agencyUser := AgencyUserFromContext(ctx)
			if agencyUser == nil {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// Check IsAdmin flag
			if !agencyUser.IsAdmin {
				w.WriteHeader(http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
