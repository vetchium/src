package mesh

import (
	"net/http"

	"github.com/jackc/pgx/v5"

	directoryspec "github.com/vetchium/src/typespec/directory"
	blocksspec "github.com/vetchium/src/typespec/hub/blocks"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

// RelayCheckBlock answers a local hub-api that asks whether a Hub user
// blocked the viewer. The viewer is the blocked user and must be homed here.
func RelayCheckBlock(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request blocksspec.CheckBlockRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		viewer, err := dbvalue.ParseUUID(string(request.BlockedHubUserDID))
		if err != nil {
			s.ValidationFailed(r.Context(), w, []string{"blocked_hub_user_did"})
			return
		}
		handle, err := s.Queries.GetHubProfileViewer(r.Context(), viewer)
		if err == pgx.ErrNoRows ||
			(err == nil && handle != string(request.ViewerHandle)) {
			s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read block viewer", err)
			return
		}
		home, details, err := s.Directory.ResolvePrincipal(
			r.Context(), directoryspec.ResolvePrincipalRequest{
				PrincipalType: directoryspec.PrincipalHubUser,
				PrincipalDID:  directoryspec.PrincipalDID(request.BlockerHubUserDID),
			},
		)
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			return
		}
		if details != nil {
			writeProfileDirectoryProblem(s, w, r, details.Type)
			return
		}
		if string(home.HomeTenantID) == s.TenantID {
			writeBlocked(s, w, r, request)
			return
		}
		outcome, err := s.Blocks.PeerCheck(r.Context(), home.HomeTenantID, request)
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			return
		}
		if outcome.Problem != nil {
			if outcome.Problem.Type == hubproblem.ProfileNotFoundError.Type {
				s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
			} else {
				s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			}
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK,
			blocksspec.CheckBlockResponse{Blocked: outcome.Blocked})
	}
}

// PeerCheckBlock answers another tenant's block check after verifying that
// the calling tenant homes the viewer (PST-RD-003).
func PeerCheckBlock(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := meshidentity.TenantFromContext(r.Context())
		if !ok {
			s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
			return
		}
		var request blocksspec.CheckBlockRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		viewer, details, err := s.Directory.ResolveProfileSlug(
			r.Context(), directoryspec.ResolveProfileSlugRequest{
				Slug: string(request.ViewerHandle),
			},
		)
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			return
		}
		if details != nil {
			writeProfileDirectoryProblem(s, w, r, details.Type)
			return
		}
		if !blockViewerBelongsToCaller(viewer, request, caller) {
			s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
			return
		}
		writeBlocked(s, w, r, request)
	}
}

func blockViewerBelongsToCaller(
	resolved directoryspec.ResolveProfileSlugResponse,
	request blocksspec.CheckBlockRequest, caller directoryspec.TenantID,
) bool {
	return resolved.Kind == directoryspec.ProfileSlugKindHandle &&
		resolved.HubUserDID == request.BlockedHubUserDID &&
		resolved.HomeTenantID == caller &&
		resolved.Slug == string(request.ViewerHandle)
}

func writeBlocked(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	request blocksspec.CheckBlockRequest,
) {
	blocker, err := dbvalue.ParseUUID(string(request.BlockerHubUserDID))
	if err != nil {
		s.ValidationFailed(r.Context(), w, []string{"blocker_hub_user_did"})
		return
	}
	blocked, err := dbvalue.ParseUUID(string(request.BlockedHubUserDID))
	if err != nil {
		s.ValidationFailed(r.Context(), w, []string{"blocked_hub_user_did"})
		return
	}
	exists, err := s.Queries.HubUserBlockExists(
		r.Context(), sqlc.HubUserBlockExistsParams{
			BlockerHubUserDid: blocker, BlockedHubUserDid: blocked,
		},
	)
	if err != nil {
		s.InternalError(r.Context(), w, "check Hub user block", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK,
		blocksspec.CheckBlockResponse{Blocked: exists})
}
