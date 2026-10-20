package mesh

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/dbvalue"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

// localAgencyRead is a local Hub user's profile with the months of each
// verified professional-email domain, never an address or an instant
// (MKT-PRF-001). pgx.ErrNoRows reports an unknown account.
func localAgencyRead(
	ctx context.Context, s *meshapi.Server, did hub.HubUserDID,
) (contacts.AgencyProfileRead, error) {
	id, err := dbvalue.ParseUUID(string(did))
	if err != nil {
		return contacts.AgencyProfileRead{}, pgx.ErrNoRows
	}
	hubProfile, err := localProfile(ctx, s, did)
	if err != nil {
		return contacts.AgencyProfileRead{}, err
	}
	rows, err := s.Queries.ListHubVerifiedDomains(ctx, id)
	if err != nil {
		return contacts.AgencyProfileRead{}, err
	}
	read := contacts.AgencyProfileRead{
		HubUserDID: did, Profile: hubProfile,
		VerifiedDomains: make([]contacts.VerifiedDomain, 0, len(rows)),
	}
	for _, row := range rows {
		read.VerifiedDomains = append(read.VerifiedDomains, contacts.VerifiedDomain{
			Domain:             common.ProfessionalDomain(row.Domain),
			FirstVerifiedMonth: profile.ProfileMonth(row.FirstVerifiedMonth),
			LastVerifiedMonth:  profile.ProfileMonth(row.LastVerifiedMonth),
		})
	}
	return read, nil
}

// RelayReadAgencyProfile serves the local orgs-api, which authenticated the
// agency user: this tenant's own Hub users from the database, another
// tenant's through its peer listener. An unknown handle or alias is one
// answer; any failure to get an answer is an unavailable tenant.
func RelayReadAgencyProfile(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request contacts.RelayReadAgencyProfileRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		resolved, details, err := s.Directory.ResolveProfileSlug(
			r.Context(), directoryspec.ResolveProfileSlugRequest{
				Slug: string(request.Address),
			},
		)
		if err == nil && details != nil &&
			details.Type == coordinatorproblem.DirectoryEntryNotFoundError.Type {
			s.Problem(r.Context(), w, orgsproblem.HubUserNotFoundError)
			return
		}
		if err != nil || details != nil || resolved.Slug != string(request.Address) {
			listingTenantUnavailable(s, w, r, directoryspec.TenantID(s.TenantID), err, details)
			return
		}
		var read contacts.AgencyProfileRead
		if string(resolved.HomeTenantID) == s.TenantID {
			read, err = localAgencyRead(r.Context(), s, resolved.HubUserDID)
			if errors.Is(err, pgx.ErrNoRows) {
				s.Problem(r.Context(), w, orgsproblem.HubUserNotFoundError)
				return
			}
			if err != nil {
				s.InternalError(r.Context(), w, "read local agency profile", err)
				return
			}
		} else {
			outcome, err := s.Profiles.PeerAgencyRead(
				r.Context(), resolved.HomeTenantID,
				contacts.PeerReadAgencyProfileRequest{
					AgencyOrgDID:     request.AgencyOrgDID,
					TargetHubUserDID: resolved.HubUserDID,
				},
			)
			if err == nil && outcome.Problem != nil &&
				outcome.Problem.Type == orgsproblem.HubUserNotFoundError.Type {
				s.Problem(r.Context(), w, orgsproblem.HubUserNotFoundError)
				return
			}
			if err != nil || outcome.Problem != nil || outcome.Read == nil {
				listingTenantUnavailable(s, w, r, resolved.HomeTenantID, err, outcome.Problem)
				return
			}
			read = *outcome.Read
		}
		if !profileMatchesResolvedSlug(read.Profile, resolved) ||
			read.HubUserDID != resolved.HubUserDID {
			s.Problem(r.Context(), w, orgsproblem.HubUserNotFoundError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, read)
	}
}

// PeerReadAgencyProfile serves another tenant's agency. Only a caller that
// homes the agency Org the request names is answered; any other learns
// nothing about the accounts this tenant homes.
func PeerReadAgencyProfile(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := meshidentity.TenantFromContext(r.Context())
		if !ok {
			peerAuthenticationRequired(s, w, r)
			return
		}
		var request contacts.PeerReadAgencyProfileRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		resolved, details, err := s.Directory.ResolvePrincipal(r.Context(),
			directoryspec.ResolvePrincipalRequest{
				PrincipalType: directoryspec.PrincipalOrg,
				PrincipalDID:  directoryspec.PrincipalDID(request.AgencyOrgDID),
			})
		if err != nil || (details != nil &&
			details.Type != coordinatorproblem.DirectoryEntryNotFoundError.Type) {
			listingTenantUnavailable(s, w, r, caller, err, details)
			return
		}
		if details != nil || resolved.HomeTenantID != caller {
			s.Problem(r.Context(), w, orgsproblem.HubUserNotFoundError)
			return
		}
		read, err := localAgencyRead(r.Context(), s, request.TargetHubUserDID)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.HubUserNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read peer agency profile", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, read)
	}
}
