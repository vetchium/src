package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/agency"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func RegisterAgencyRoutes(mux *http.ServeMux, s *server.Server) {
	// Unauthenticated routes
	mux.HandleFunc("POST /agency/init-signup", agency.InitSignup(s))
	mux.HandleFunc("POST /agency/get-signup-details", agency.GetSignupDetails(s))
	mux.HandleFunc("POST /agency/complete-signup", agency.CompleteSignup(s))
	mux.HandleFunc("POST /agency/login", agency.Login(s))
	mux.HandleFunc("POST /agency/tfa", agency.TFA(s))
	mux.HandleFunc("POST /agency/complete-setup", agency.CompleteSetup(s))
	mux.HandleFunc("POST /agency/request-password-reset", agency.RequestPasswordReset(s))
	mux.HandleFunc("POST /agency/complete-password-reset", agency.CompletePasswordReset(s))

	// Create middleware instances
	agencyAuth := middleware.AgencyAuth(s.Regional, s.CurrentRegion, s.InternalEndpoints)
	agencyRoleInvite := middleware.AgencyRole(s.Regional, "agency:invite_users")
	agencyRoleManage := middleware.AgencyRole(s.Regional, "agency:manage_users")

	// Admin-only routes (IsAdmin flag required, not delegatable)
	mux.Handle("POST /agency/assign-role", agencyAuth(agencyRoleManage(agency.AssignRole(s))))
	mux.Handle("POST /agency/remove-role", agencyAuth(agencyRoleManage(agency.RemoveRole(s))))

	// Role-protected routes (IsAdmin OR role)
	mux.Handle("POST /agency/invite-user", agencyAuth(agencyRoleInvite(agency.InviteUser(s))))
	mux.Handle("POST /agency/disable-user", agencyAuth(agencyRoleManage(agency.DisableUser(s))))
	mux.Handle("POST /agency/enable-user", agencyAuth(agencyRoleManage(agency.EnableUser(s))))

	// Auth-only routes (any authenticated agency user)
	mux.Handle("POST /agency/logout", agencyAuth(agency.Logout(s)))
	mux.Handle("POST /agency/change-password", agencyAuth(agency.ChangePassword(s)))
	mux.Handle("POST /agency/set-language", agencyAuth(agency.SetLanguage(s)))
	mux.Handle("GET /agency/myinfo", agencyAuth(agency.MyInfo(s)))
	mux.Handle("POST /agency/filter-users", agencyAuth(agency.FilterUsers(s)))
}
