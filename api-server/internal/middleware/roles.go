package middleware

import (
	"net/http"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// AdminRole checks if the authenticated admin user has ANY of the required roles.
// Superadmin (admin:superadmin) is always prepended and bypasses any specific role requirement.
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

			// Check if user has ANY of the required roles.
			// Superadmin can access everything any specific role can.
			checkRoles := append([]string{"admin:superadmin"}, requiredRoles...)
			for _, requiredRole := range checkRoles {
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
// Superadmin (employer:superadmin) is always prepended and bypasses any specific role requirement.
// If no roles are specified, only authentication is required (any authenticated employer can access).
// Returns 403 if user lacks all required roles.
// Must be chained after OrgAuth middleware.
func EmployerRole(regionalDB *regionaldb.Queries, requiredRoles ...string) func(http.Handler) http.Handler {
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

			// If no roles specified, allow access (auth-only)
			if len(requiredRoles) == 0 {
				next.ServeHTTP(w, r)
				return
			}

			// Check if user has ANY of the required roles (roles are in regional DB)
			// Superadmin can access everything any specific role can
			checkRoles := append([]string{"employer:superadmin"}, requiredRoles...)
			for _, requiredRole := range checkRoles {
				role, err := regionalDB.GetRoleByName(ctx, requiredRole)
				if err != nil {
					continue
				}

				hasRole, err := regionalDB.HasOrgUserRole(ctx, regionaldb.HasOrgUserRoleParams{
					OrgUserID: orgUser.OrgUserID,
					RoleID:    role.RoleID,
				})
				if err != nil {
					continue
				}

				if hasRole {
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
// Superadmin (agency:superadmin) is always prepended and bypasses any specific role requirement.
// If no roles are specified, only authentication is required (any authenticated agency user can access).
// Returns 403 if user lacks all required roles.
// Must be chained after AgencyAuth middleware.
func AgencyRole(regionalDB *regionaldb.Queries, requiredRoles ...string) func(http.Handler) http.Handler {
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

			// If no roles specified, allow access (auth-only)
			if len(requiredRoles) == 0 {
				next.ServeHTTP(w, r)
				return
			}

			// Check if user has ANY of the required roles (roles are in regional DB)
			// Superadmin can access everything any specific role can
			checkRoles := append([]string{"agency:superadmin"}, requiredRoles...)
			for _, requiredRole := range checkRoles {
				role, err := regionalDB.GetRoleByName(ctx, requiredRole)
				if err != nil {
					continue
				}

				hasRole, err := regionalDB.HasAgencyUserRole(ctx, regionaldb.HasAgencyUserRoleParams{
					AgencyUserID: agencyUser.AgencyUserID,
					RoleID:       role.RoleID,
				})
				if err != nil {
					continue
				}

				if hasRole {
					next.ServeHTTP(w, r)
					return
				}
			}

			// User doesn't have any of the required roles
			w.WriteHeader(http.StatusForbidden)
		})
	}
}

// HubRole checks if the authenticated hub user has ANY of the required roles.
// If no roles are specified, only authentication is required (any authenticated hub user can access).
// Returns 403 if user lacks all required roles.
// Must be chained after HubAuth middleware.
func HubRole(regionalDB *regionaldb.Queries, requiredRoles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			ctx := r.Context()

			// Get hub user from context (set by HubAuth)
			hubUser := HubUserFromContext(ctx)
			if hubUser == nil {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			// If no roles specified, allow access (auth-only)
			if len(requiredRoles) == 0 {
				next.ServeHTTP(w, r)
				return
			}

			// Check if user has ANY of the required roles (roles are in regional DB)
			for _, requiredRole := range requiredRoles {
				role, err := regionalDB.GetRoleByName(ctx, requiredRole)
				if err != nil {
					continue
				}

				hasRole, err := regionalDB.HasHubUserRole(ctx, regionaldb.HasHubUserRoleParams{
					HubUserGlobalID: hubUser.HubUserGlobalID,
					RoleID:          role.RoleID,
				})
				if err != nil {
					continue
				}

				if hasRole {
					next.ServeHTTP(w, r)
					return
				}
			}

			// User doesn't have any of the required roles
			w.WriteHeader(http.StatusForbidden)
		})
	}
}
