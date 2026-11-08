package contacts

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

func hubHandle(value string) hub.HubHandle { return hub.HubHandle(value) }

func profileAddress(value string) profile.ProfileAddress { return profile.ProfileAddress(value) }

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// readProfile reads the person at address through the local mesh-api, which
// resolves it through the directory and asks the account's home tenant. It
// writes the problem and reports false when there is no profile to show.
func readProfile(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	identity middleware.OrgIdentity, address string,
) (contacts.AgencyProfileRead, bool) {
	outcome, err := s.Profiles.RelayAgencyRead(r.Context(),
		contacts.RelayReadAgencyProfileRequest{
			AgencyOrgDID: orgDID(identity.OrgDID),
			Address:      profileAddress(address),
		})
	if err == nil && outcome.Problem != nil &&
		outcome.Problem.Type == orgsproblem.HubUserNotFoundError.Type {
		s.Problem(r.Context(), w, orgsproblem.HubUserNotFoundError)
		return contacts.AgencyProfileRead{}, false
	}
	if err != nil || outcome.Problem != nil || outcome.Read == nil {
		unavailable(s, w, r, err)
		return contacts.AgencyProfileRead{}, false
	}
	return *outcome.Read, true
}

// ViewHubProfile shows a Hub user's profile to an agency user and records
// nothing about the view; it only keeps a Contact's recorded name current
// (MKT-PRF-001, MKT-PRF-003).
func ViewHubProfile(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request contacts.ViewHubProfileRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		read, ok := readProfile(s, w, r, identity, string(request.Address))
		if !ok {
			return
		}
		hubDID, err := dbvalue.ParseUUID(string(read.HubUserDID))
		if err != nil {
			s.InternalError(r.Context(), w, "parse Hub user DID", err)
			return
		}
		response := contacts.AgencyProfile{
			Profile: read.Profile, VerifiedDomains: read.VerifiedDomains,
		}
		row, err := s.Queries.GetOrgContactByPerson(r.Context(),
			sqlc.GetOrgContactByPersonParams{
				OrgDid: identity.OrgDID, HubUserDid: hubDID,
			})
		switch {
		case isNoRows(err):
		case err != nil:
			s.InternalError(r.Context(), w, "read Contact", err)
			return
		default:
			credited := creditedCounts(r.Context(), s, identity.OrgDID,
				[]pgtype.UUID{hubDID})[dbvalue.FormatUUID(hubDID)]
			found := summary(sqlc.ListOrgContactsRow(row), credited, time.Now())
			if refreshed, err := refreshNames(s, r, identity, row, read); err != nil {
				s.InternalError(r.Context(), w, "refresh Contact names", err)
				return
			} else if refreshed {
				found.DisplayName = read.Profile.DisplayName
			}
			response.Contact = &found
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// refreshNames keeps the name a Contact records as last read, so its lists
// need no cross-tenant read (MKT-CON-001). Handles never change.
func refreshNames(
	s *orgsruntime.Server, r *http.Request, identity middleware.OrgIdentity,
	row sqlc.GetOrgContactByPersonRow, read contacts.AgencyProfileRead,
) (bool, error) {
	name := string(read.Profile.DisplayName)
	if row.DisplayName == name {
		return false, nil
	}
	changed, err := s.Queries.RefreshOrgContactNames(r.Context(),
		sqlc.RefreshOrgContactNamesParams{
			DisplayName: name, HubUserDid: row.HubUserDid,
			OrgDid: identity.OrgDID, TenantID: s.TenantID, ActorID: identity.UserID,
		})
	if err != nil {
		return false, err
	}
	return changed.ChangedRows == 1 && changed.AuditRows == 1, nil
}
