package mesh

import (
	"errors"
	"net/http"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub/applications"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/hubapplications"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

// RelayGetHubApplication reads a local Hub user's application at the home
// tenant of the Org that holds the domain. hub-api has already read a local
// Org itself.
func RelayGetHubApplication(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request hubspec.MeshGetApplicationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		resolved, details, err := s.Directory.ResolveOrgDomain(r.Context(),
			directoryspec.ResolveOrgDomainRequest{Domain: request.Domain})
		switch {
		case err != nil || (details != nil && details.Type !=
			coordinatorproblem.DirectoryEntryNotFoundError.Type) ||
			(details == nil && resolved.Domain != request.Domain):
			s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
			return
		case details != nil:
			s.Problem(r.Context(), w, hubproblem.ApplicationNotFoundError)
			return
		case string(resolved.HomeTenantID) == s.TenantID:
			writeApplicantRead(s, w, r, request)
			return
		}
		outcome, err := s.Applications.PeerGet(
			r.Context(), resolved.HomeTenantID, request,
		)
		if err != nil {
			s.WarnContext(r.Context(), "Hub application peer read failed",
				"event", "hub_application_peer_unavailable",
				"tenant", resolved.HomeTenantID, "error", err)
			s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
			return
		}
		if outcome.Problem != nil {
			if outcome.Problem.Type == hubproblem.ApplicationNotFoundError.Type {
				s.Problem(r.Context(), w, hubproblem.ApplicationNotFoundError)
			} else {
				s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
			}
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, outcome.Result)
	}
}

// PeerGetHubApplication answers another tenant's read of its own Hub user's
// application. The directory must home the asserted applicant at the calling
// tenant; any other applicant is answered as an unknown application.
func PeerGetHubApplication(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := meshidentity.TenantFromContext(r.Context())
		if !ok {
			s.AuthenticationProblem(r.Context(), w,
				coordinatorproblem.MeshPeerAuthenticationRequiredError,
				`MutualTLS realm="mesh-api"`)
			return
		}
		var request hubspec.MeshGetApplicationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		resolved, details, err := s.Directory.ResolvePrincipal(r.Context(),
			directoryspec.ResolvePrincipalRequest{
				PrincipalType: directoryspec.PrincipalHubUser,
				PrincipalDID: directoryspec.PrincipalDID(
					request.ApplicantDID,
				),
			})
		switch {
		case err != nil || (details != nil && details.Type !=
			coordinatorproblem.DirectoryEntryNotFoundError.Type):
			s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
			return
		case details != nil || resolved.HomeTenantID != caller:
			s.Problem(r.Context(), w, hubproblem.ApplicationNotFoundError)
			return
		}
		writeApplicantRead(s, w, r, request)
	}
}

func writeApplicantRead(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	request hubspec.MeshGetApplicationRequest,
) {
	application, err := hubapplications.ReadForApplicant(
		r.Context(), s.Queries, s.OfferLetters, request,
	)
	if errors.Is(err, hubapplications.ErrNotFound) {
		s.Problem(r.Context(), w, hubproblem.ApplicationNotFoundError)
		return
	}
	if err != nil {
		s.InternalError(r.Context(), w, "read Hub application", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK, application)
}
