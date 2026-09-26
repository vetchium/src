package mesh

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	directoryproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

func RelayReadProfile(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request profilespec.RelayReadProfileRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		viewer, err := dbvalue.ParseUUID(string(request.ViewerHubUserDID))
		if err != nil {
			s.ValidationFailed(r.Context(), w, []string{"viewer_hub_user_did"})
			return
		}
		handle, err := s.Queries.GetHubProfileViewer(r.Context(), viewer)
		if errors.Is(err, pgx.ErrNoRows) ||
			(err == nil && handle != string(request.ViewerHandle)) {
			s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read profile viewer", err)
			return
		}
		resolved, details, err := s.Directory.ResolveProfileSlug(
			r.Context(), directoryspec.ResolveProfileSlugRequest{
				Slug: string(request.Address),
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
		if resolved.Slug != string(request.Address) {
			s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			return
		}
		if string(resolved.HomeTenantID) == s.TenantID {
			profile, err := localProfile(
				r.Context(), s, resolved.HubUserDID,
			)
			if err == nil && !profileMatchesResolvedSlug(profile, resolved) {
				s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
				return
			}
			writeLocalProfile(s, w, r, profile, err)
			return
		}
		outcome, err := s.Profiles.PeerRead(
			r.Context(), resolved.HomeTenantID,
			profilespec.PeerReadProfileRequest{
				ViewerHubUserDID: request.ViewerHubUserDID,
				ViewerHandle:     request.ViewerHandle,
				TargetHubUserDID: resolved.HubUserDID,
			},
		)
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
		if outcome.Profile == nil {
			s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			return
		}
		if !profileMatchesResolvedSlug(*outcome.Profile, resolved) {
			s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, outcome.Profile)
	}
}

func profileMatchesResolvedSlug(
	profile profilespec.PublicProfile,
	resolved directoryspec.ResolveProfileSlugResponse,
) bool {
	switch resolved.Kind {
	case directoryspec.ProfileSlugKindHandle:
		return string(profile.Handle) == resolved.Slug
	case directoryspec.ProfileSlugKindAlias:
		return profile.ProfileAlias != nil &&
			string(*profile.ProfileAlias) == resolved.Slug
	default:
		return false
	}
}

func PeerReadProfile(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := meshidentity.TenantFromContext(r.Context())
		if !ok {
			s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
			return
		}
		var request profilespec.PeerReadProfileRequest
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
		if !viewerBelongsToCaller(viewer, request, caller) {
			s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
			return
		}
		profile, err := localProfile(r.Context(), s, request.TargetHubUserDID)
		writeLocalProfile(s, w, r, profile, err)
	}
}

func viewerBelongsToCaller(
	resolved directoryspec.ResolveProfileSlugResponse,
	request profilespec.PeerReadProfileRequest,
	caller directoryspec.TenantID,
) bool {
	return resolved.Kind == directoryspec.ProfileSlugKindHandle &&
		resolved.HubUserDID == request.ViewerHubUserDID &&
		resolved.HomeTenantID == caller &&
		resolved.Slug == string(request.ViewerHandle)
}

func writeProfileDirectoryProblem(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	problemType string,
) {
	if problemType == directoryproblem.DirectoryEntryNotFoundError.Type {
		s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
		return
	}
	s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
}

func localProfile(
	ctx context.Context, s *meshapi.Server, did hubspec.HubUserDID,
) (profilespec.PublicProfile, error) {
	id, err := dbvalue.ParseUUID(string(did))
	if err != nil {
		return profilespec.PublicProfile{}, err
	}
	row, err := s.Queries.GetHubPublicProfile(ctx, id)
	if err != nil {
		return profilespec.PublicProfile{}, err
	}
	return publicProfileFromRow(ctx, row, s.Pictures)
}

func publicProfileFromRow(
	ctx context.Context, row sqlc.GetHubPublicProfileRow,
	signer meshapi.PictureSigner,
) (profilespec.PublicProfile, error) {
	result := profilespec.PublicProfile{
		DisplayName:     common.DisplayName(row.DisplayName),
		Handle:          hubspec.HubHandle(row.Handle),
		ResidentCountry: common.CountryCode(row.ResidentCountry),
	}
	if row.ProfileAlias.Valid {
		alias := directoryspec.HubAlias(row.ProfileAlias.String)
		result.ProfileAlias = &alias
	}
	if row.Biography.Valid {
		biography := profilespec.ProfileLongText(row.Biography.String)
		result.Biography = &biography
	}
	if row.ProfilePictureObjectID.Valid {
		if signer == nil {
			return result, fmt.Errorf("profile picture URL signer unavailable")
		}
		pictureURL, err := signer.SignGet(ctx, row.ProfilePictureObjectID)
		if err != nil {
			return result, fmt.Errorf("sign profile picture: %w", err)
		}
		result.ProfilePictureURL = &pictureURL
	}
	for _, item := range []struct {
		name   string
		data   []byte
		target any
	}{
		{"websites", row.Websites, &result.Websites},
		{"work experiences", row.WorkExperiences, &result.WorkExperiences},
		{"certifications", row.Certifications, &result.Certifications},
		{"language abilities", row.LanguageAbilities, &result.LanguageAbilities},
		{"educational qualifications", row.EducationalQualifications,
			&result.EducationalQualifications},
	} {
		if err := json.Unmarshal(item.data, item.target); err != nil {
			return result, fmt.Errorf("decode %s: %w", item.name, err)
		}
	}
	return result, nil
}

func writeLocalProfile(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	profile profilespec.PublicProfile, err error,
) {
	if errors.Is(err, pgx.ErrNoRows) {
		s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
		return
	}
	if err != nil {
		s.InternalError(r.Context(), w, "read local Hub profile", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK, profile)
}
