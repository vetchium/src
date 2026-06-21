package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/org"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func RegisterOrgRoutes(mux *http.ServeMux, s *server.RegionalServer) {
	// Unauthenticated routes
	mux.HandleFunc("POST /org/init-signup", org.InitSignup(s))
	mux.HandleFunc("POST /org/get-signup-details", org.GetSignupDetails(s))
	mux.HandleFunc("POST /org/complete-signup", org.CompleteSignup(s))
	mux.HandleFunc("POST /org/login", org.Login(s))
	mux.HandleFunc("POST /org/tfa", org.TFA(s))
	mux.HandleFunc("POST /org/complete-setup", org.CompleteSetup(s))
	mux.HandleFunc("POST /org/request-password-reset", org.RequestPasswordReset(s))
	mux.HandleFunc("POST /org/complete-password-reset", org.CompletePasswordReset(s))

	// Create middleware instances
	orgAuth := middleware.OrgAuth(s.AllRegionalDBs)
	orgRoleViewUsers := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewUsers, orgspec.OrgRoleManageUsers)
	orgRoleManageUsers := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageUsers)
	orgRoleViewDomains := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewDomains, orgspec.OrgRoleManageDomains)
	orgRoleManageDomains := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageDomains)
	orgRoleViewCostCenters := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewCostCenters, orgspec.OrgRoleManageCostCenters)
	orgRoleManageCostCenters := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageCostCenters)
	orgRoleViewAuditLogs := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewAuditLogs)
	orgRoleViewSubOrgs := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewSubOrgs, orgspec.OrgRoleManageSubOrgs)
	orgRoleManageSubOrgs := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageSubOrgs)
	orgRoleViewPlan := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewPlan, orgspec.OrgRoleManagePlan)
	orgRoleManagePlan := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManagePlan)
	orgRoleViewListings := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewListings, orgspec.OrgRoleManageListings)
	orgRoleManageListings := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageListings)
	orgRoleSuperadmin := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleSuperadmin)
	orgRoleViewSubscriptions := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewSubscriptions, orgspec.OrgRoleManageSubscriptions)
	orgRoleManageSubscriptions := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageSubscriptions)
	orgRoleViewAddresses := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewAddresses, orgspec.OrgRoleManageAddresses)
	orgRoleManageAddresses := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageAddresses)
	orgRoleViewOpenings := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewOpenings, orgspec.OrgRoleManageOpenings)
	orgRoleManageOpenings := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageOpenings)
	orgRoleViewApplications := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewApplications, orgspec.OrgRoleManageApplications)
	orgRoleManageApplications := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageApplications)
	orgRoleViewOpeningAgencies := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewOpeningAgencies, orgspec.OrgRoleManageOpeningAgencies)
	orgRoleManageOpeningAgencies := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageOpeningAgencies)
	orgRoleReferCandidates := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleReferCandidates)
	orgRoleViewAgencyReferrals := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewAgencyReferrals, orgspec.OrgRoleManageAgencyRecruiters)
	orgRoleManageAgencyRecruiters := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageAgencyRecruiters)
	orgRoleViewCandidacies := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewApplications, orgspec.OrgRoleViewCandidacies, orgspec.OrgRoleManageCandidacies)
	orgRoleManageCandidacies := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageCandidacies)
	orgRoleViewHiringSettings := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewHiringSettings, orgspec.OrgRoleManageHiringSettings)
	orgRoleManageHiringSettings := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageHiringSettings)

	// Domain write routes (manage_domains required; superadmin bypasses via middleware)
	mux.Handle("POST /org/claim-domain", orgAuth(orgRoleManageDomains(org.ClaimDomain(s))))
	mux.Handle("POST /org/verify-domain", orgAuth(orgRoleManageDomains(org.VerifyDomain(s))))
	mux.Handle("POST /org/set-primary-domain", orgAuth(orgRoleManageDomains(org.SetPrimaryDomain(s))))
	mux.Handle("POST /org/delete-domain", orgAuth(orgRoleManageDomains(org.DeleteDomain(s))))
	// Domain read routes (view_domains or manage_domains)
	mux.Handle("POST /org/get-domain-status", orgAuth(orgRoleViewDomains(org.GetDomainStatus(s))))
	mux.Handle("POST /org/list-domains", orgAuth(orgRoleViewDomains(org.ListDomains(s))))
	mux.Handle("POST /org/assign-role", orgAuth(orgRoleManageUsers(org.AssignRole(s))))
	mux.Handle("POST /org/remove-role", orgAuth(orgRoleManageUsers(org.RemoveRole(s))))

	// User management write routes (manage_users required)
	mux.Handle("POST /org/invite-user", orgAuth(orgRoleManageUsers(org.InviteUser(s))))
	mux.Handle("POST /org/disable-user", orgAuth(orgRoleManageUsers(org.DisableUser(s))))
	mux.Handle("POST /org/enable-user", orgAuth(orgRoleManageUsers(org.EnableUser(s))))

	// Auth-only routes (any authenticated org user)
	mux.Handle("POST /org/logout", orgAuth(org.Logout(s)))
	mux.Handle("POST /org/change-password", orgAuth(org.ChangePassword(s)))
	mux.Handle("POST /org/set-language", orgAuth(org.SetLanguage(s)))
	mux.Handle("GET /org/myinfo", orgAuth(org.MyInfo(s)))
	mux.Handle("POST /org/list-users", orgAuth(orgRoleViewUsers(org.FilterUsers(s))))

	// Tag read routes (auth-only, no role restriction)
	mux.Handle("POST /org/get-tag", orgAuth(org.GetTag(s)))
	mux.Handle("POST /org/list-tags", orgAuth(org.FilterTags(s)))

	// Cost center routes
	mux.Handle("POST /org/create-cost-center", orgAuth(orgRoleManageCostCenters(org.AddCostCenter(s))))
	mux.Handle("POST /org/update-cost-center", orgAuth(orgRoleManageCostCenters(org.UpdateCostCenter(s))))
	mux.Handle("POST /org/list-cost-centers", orgAuth(orgRoleViewCostCenters(org.ListCostCenters(s))))

	// Company Address routes
	mux.Handle("POST /org/create-address", orgAuth(orgRoleManageAddresses(org.CreateAddress(s))))
	mux.Handle("POST /org/update-address", orgAuth(orgRoleManageAddresses(org.UpdateAddress(s))))
	mux.Handle("POST /org/disable-address", orgAuth(orgRoleManageAddresses(org.DisableAddress(s))))
	mux.Handle("POST /org/enable-address", orgAuth(orgRoleManageAddresses(org.EnableAddress(s))))
	mux.Handle("POST /org/get-address", orgAuth(orgRoleViewAddresses(org.GetAddress(s))))
	mux.Handle("POST /org/list-addresses", orgAuth(orgRoleViewAddresses(org.ListAddresses(s))))

	// SubOrg routes
	mux.Handle("POST /org/create-suborg", orgAuth(orgRoleManageSubOrgs(org.CreateSubOrg(s))))
	mux.Handle("POST /org/list-suborgs", orgAuth(orgRoleViewSubOrgs(org.ListSubOrgs(s))))
	mux.Handle("POST /org/rename-suborg", orgAuth(orgRoleManageSubOrgs(org.RenameSubOrg(s))))
	mux.Handle("POST /org/disable-suborg", orgAuth(orgRoleManageSubOrgs(org.DisableSubOrg(s))))
	mux.Handle("POST /org/enable-suborg", orgAuth(orgRoleManageSubOrgs(org.EnableSubOrg(s))))
	mux.Handle("POST /org/add-suborg-member", orgAuth(orgRoleManageSubOrgs(org.AddSubOrgMember(s))))
	mux.Handle("POST /org/remove-suborg-member", orgAuth(orgRoleManageSubOrgs(org.RemoveSubOrgMember(s))))
	mux.Handle("POST /org/list-suborg-members", orgAuth(orgRoleViewSubOrgs(org.ListSubOrgMembers(s))))

	// Audit log routes
	mux.Handle("POST /org/list-audit-logs", orgAuth(orgRoleViewAuditLogs(org.FilterAuditLogs(s))))

	// Org plan routes
	mux.Handle("POST /org/list-plans", orgAuth(org.ListPlans(s)))
	mux.Handle("POST /org/get-plan", orgAuth(orgRoleViewPlan(org.GetMyOrgPlan(s))))
	mux.Handle("POST /org/upgrade-plan", orgAuth(orgRoleManagePlan(org.UpgradeOrgPlan(s))))

	// Marketplace capability routes (auth-only)
	mux.Handle("POST /org/marketplace/list-capabilities", orgAuth(org.ListMarketplaceCapabilities(s)))

	// Marketplace listing routes
	mux.Handle("POST /org/marketplace/create-listing", orgAuth(orgRoleManageListings(org.CreateMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/update-listing", orgAuth(orgRoleManageListings(org.UpdateMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/publish-listing", orgAuth(orgRoleManageListings(org.PublishMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/approve-listing", orgAuth(orgRoleSuperadmin(org.ApproveListing(s))))
	mux.Handle("POST /org/marketplace/reject-listing", orgAuth(orgRoleSuperadmin(org.RejectListing(s))))
	mux.Handle("POST /org/marketplace/archive-listing", orgAuth(orgRoleManageListings(org.ArchiveMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/reopen-listing", orgAuth(orgRoleManageListings(org.ReopenMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/add-listing-capability", orgAuth(orgRoleManageListings(org.AddListingCapability(s))))
	mux.Handle("POST /org/marketplace/remove-listing-capability", orgAuth(orgRoleManageListings(org.RemoveListingCapability(s))))
	mux.Handle("POST /org/marketplace/list-listings", orgAuth(orgRoleViewListings(org.ListMyListings(s))))
	mux.Handle("POST /org/marketplace/get-listing", orgAuth(org.GetMarketplaceListing(s)))

	// Marketplace discovery
	mux.Handle("POST /org/marketplace/discover", orgAuth(org.DiscoverListings(s)))

	// Marketplace subscription routes
	mux.Handle("POST /org/marketplace/create-subscription", orgAuth(orgRoleManageSubscriptions(org.Subscribe(s))))
	mux.Handle("POST /org/marketplace/cancel-subscription", orgAuth(orgRoleManageSubscriptions(org.CancelSubscription(s))))
	mux.Handle("POST /org/marketplace/list-subscriptions", orgAuth(orgRoleViewSubscriptions(org.ListMySubscriptions(s))))
	mux.Handle("POST /org/marketplace/get-subscription", orgAuth(orgRoleViewSubscriptions(org.GetSubscription(s))))

	// Marketplace clients (provider view)
	mux.Handle("POST /org/marketplace/list-clients", orgAuth(orgRoleViewListings(org.ListMyClients(s))))

	// Watcher routes (manage_openings required)
	mux.Handle("POST /org/add-watcher", orgAuth(orgRoleManageOpenings(org.AddWatcher(s))))
	mux.Handle("POST /org/remove-watcher", orgAuth(orgRoleManageOpenings(org.RemoveWatcher(s))))

	// Job opening routes
	mux.Handle("POST /org/create-opening", orgAuth(orgRoleManageOpenings(org.CreateOpening(s))))
	mux.Handle("POST /org/list-openings", orgAuth(orgRoleViewOpenings(org.ListOpenings(s))))
	mux.Handle("POST /org/get-opening", orgAuth(orgRoleViewOpenings(org.GetOpening(s))))
	mux.Handle("POST /org/update-opening", orgAuth(orgRoleManageOpenings(org.UpdateOpening(s))))
	mux.Handle("POST /org/discard-opening", orgAuth(orgRoleManageOpenings(org.DiscardOpening(s))))
	mux.Handle("POST /org/duplicate-opening", orgAuth(orgRoleManageOpenings(org.DuplicateOpening(s))))
	mux.Handle("POST /org/submit-opening", orgAuth(orgRoleManageOpenings(org.SubmitOpening(s))))
	mux.Handle("POST /org/approve-opening", orgAuth(orgRoleManageOpenings(org.ApproveOpening(s))))
	mux.Handle("POST /org/reject-opening", orgAuth(orgRoleManageOpenings(org.RejectOpening(s))))
	mux.Handle("POST /org/pause-opening", orgAuth(orgRoleManageOpenings(org.PauseOpening(s))))
	mux.Handle("POST /org/reopen-opening", orgAuth(orgRoleManageOpenings(org.ReopenOpening(s))))
	mux.Handle("POST /org/close-opening", orgAuth(orgRoleManageOpenings(org.CloseOpening(s))))
	mux.Handle("POST /org/archive-opening", orgAuth(orgRoleManageOpenings(org.ArchiveOpening(s))))

	// Agency referral routes (consumer assigns agencies; agency refers)
	mux.Handle("POST /org/assign-opening-agency", orgAuth(orgRoleManageOpeningAgencies(org.AssignOpeningAgency(s))))
	mux.Handle("POST /org/remove-opening-agency", orgAuth(orgRoleManageOpeningAgencies(org.RemoveOpeningAgency(s))))
	mux.Handle("POST /org/list-opening-agencies", orgAuth(orgRoleViewOpeningAgencies(org.ListOpeningAgencies(s))))
	mux.Handle("POST /org/list-assignable-agencies", orgAuth(orgRoleManageOpeningAgencies(org.ListAssignableAgencies(s))))
	mux.Handle("POST /org/list-staffing-clients", orgAuth(orgRoleViewAgencyReferrals(org.ListStaffingClients(s))))
	mux.Handle("POST /org/list-assigned-openings", orgAuth(orgRoleViewAgencyReferrals(org.ListAssignedOpenings(s))))
	mux.Handle("POST /org/get-assigned-opening", orgAuth(orgRoleViewAgencyReferrals(org.GetAssignedOpening(s))))
	mux.Handle("POST /org/refer-candidate", orgAuth(orgRoleReferCandidates(org.ReferCandidate(s))))
	mux.Handle("POST /org/list-agency-referrals", orgAuth(orgRoleViewAgencyReferrals(org.ListAgencyReferrals(s))))
	mux.Handle("POST /org/list-agency-recruiters", orgAuth(orgRoleViewAgencyReferrals(org.ListAgencyRecruiters(s))))
	mux.Handle("POST /org/get-agency-referral-summary", orgAuth(orgRoleViewAgencyReferrals(org.GetAgencyReferralSummary(s))))
	mux.Handle("POST /org/reassign-opening", orgAuth(orgRoleManageAgencyRecruiters(org.ReassignOpening(s))))
	mux.Handle("POST /org/list-client-default-assignees", orgAuth(orgRoleViewAgencyReferrals(org.ListClientDefaultAssignees(s))))
	mux.Handle("POST /org/set-client-default-assignee", orgAuth(orgRoleManageAgencyRecruiters(org.SetClientDefaultAssignee(s))))
	mux.Handle("POST /org/clear-client-default-assignee", orgAuth(orgRoleManageAgencyRecruiters(org.ClearClientDefaultAssignee(s))))

	// Hiring settings routes
	mux.Handle("POST /org/get-hiring-settings", orgAuth(orgRoleViewHiringSettings(org.GetHiringSettings(s))))
	mux.Handle("POST /org/update-hiring-settings", orgAuth(orgRoleManageHiringSettings(org.UpdateHiringSettings(s))))

	// Application management routes
	mux.Handle("POST /org/list-applications", orgAuth(orgRoleViewApplications(org.ListApplications(s))))
	mux.Handle("POST /org/get-application", orgAuth(orgRoleViewApplications(org.GetApplication(s))))
	mux.Handle("GET /org/application-resume/{applicationId}", orgAuth(orgRoleViewApplications(org.ApplicationResume(s))))
	mux.Handle("POST /org/shortlist-application", orgAuth(orgRoleManageApplications(org.ShortlistApplication(s))))
	mux.Handle("POST /org/reject-application", orgAuth(orgRoleManageApplications(org.RejectApplication(s))))
	mux.Handle("POST /org/label-application", orgAuth(orgRoleManageApplications(org.LabelApplication(s))))

	// Hub user profile viewing (org users can view applicant public profiles)
	mux.Handle("POST /org/get-hub-user-profile", orgAuth(org.GetHubUserProfile(s)))

	// Candidacy management routes
	mux.Handle("POST /org/list-candidacies", orgAuth(orgRoleViewCandidacies(org.ListCandidacies(s))))
	mux.Handle("POST /org/get-candidacy", orgAuth(orgRoleViewCandidacies(org.GetCandidacy(s))))
	mux.Handle("GET /org/offer-letter/{candidacyId}", orgAuth(orgRoleViewCandidacies(org.GetOfferLetter(s))))
	mux.Handle("GET /org/candidacy-resume/{candidacyId}", orgAuth(orgRoleViewCandidacies(org.CandidacyResume(s))))
	mux.Handle("GET /org/interview-resume/{interviewId}", orgAuth(org.InterviewResume(s)))
	mux.Handle("POST /org/add-candidacy-comment", orgAuth(orgRoleManageCandidacies(org.AddCandidacyComment(s))))

	// Interview management routes (T2 Tranche)
	mux.Handle("POST /org/schedule-interview", orgAuth(orgRoleManageCandidacies(org.ScheduleInterview(s))))
	mux.Handle("POST /org/list-interviews", orgAuth(orgRoleViewCandidacies(org.ListInterviews(s))))
	mux.Handle("POST /org/get-interview", orgAuth(orgRoleViewCandidacies(org.GetInterview(s))))
	mux.Handle("POST /org/update-interview", orgAuth(orgRoleManageCandidacies(org.UpdateInterview(s))))
	mux.Handle("POST /org/cancel-interview", orgAuth(orgRoleManageCandidacies(org.CancelInterview(s))))
	mux.Handle("POST /org/add-interviewer", orgAuth(orgRoleManageCandidacies(org.AddInterviewer(s))))
	mux.Handle("POST /org/remove-interviewer", orgAuth(orgRoleManageCandidacies(org.RemoveInterviewer(s))))
	mux.Handle("POST /org/submit-interview-feedback", orgAuth(org.SubmitInterviewFeedback(s)))
	mux.Handle("POST /org/save-interview-feedback", orgAuth(org.SaveInterviewFeedback(s)))
	mux.Handle("POST /org/get-my-interview-feedback", orgAuth(org.GetMyInterviewFeedback(s)))
	mux.Handle("POST /org/complete-interview", orgAuth(org.CompleteInterview(s)))
	mux.Handle("POST /org/rsvp-interview", orgAuth(org.RSVPInterview(s)))
	mux.Handle("POST /org/list-my-interviews", orgAuth(org.ListMyInterviews(s)))

	// Offer management routes (T2 Tranche)
	mux.Handle("POST /org/extend-offer", orgAuth(orgRoleManageCandidacies(org.ExtendOffer(s))))

	// Reference management routes (T4 Tranche)
	mux.Handle("POST /org/request-references", orgAuth(orgRoleManageCandidacies(org.RequestReferences(s))))
	mux.Handle("POST /org/list-reference-nominations", orgAuth(orgRoleViewCandidacies(org.ListReferenceNominations(s))))
	mux.Handle("POST /org/list-reference-responses", orgAuth(orgRoleViewCandidacies(org.ListReferenceResponses(s))))

}
