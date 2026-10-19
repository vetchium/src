package applications

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	hubspec "github.com/vetchium/src/typespec/hub"
	applicationspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

// The relay's deterministic authority-not-found means the directory no
// longer has the Org the domain resolved to.
var applyRejections = map[string]problem.Details{
	hubproblem.OpeningNotFoundError.Type:          hubproblem.OpeningNotFoundError,
	hubproblem.OpeningNotAcceptingError.Type:      hubproblem.OpeningNotAcceptingError,
	hubproblem.ApplicationExistsError.Type:        hubproblem.ApplicationExistsError,
	federationproblem.AuthorityNotFoundError.Type: hubproblem.OrgNotFoundError,
}

func Apply(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applicationspec.ApplyToOpeningRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		orgDID, ok := resolveOrgForWrite(s, w, r, request.Domain,
			hubproblem.OrgNotFoundError)
		if !ok {
			return
		}
		snapshot, err := applicantSnapshot(r.Context(), s.Queries,
			identity.UserDID)
		if err != nil {
			s.InternalError(r.Context(), w, "build applicant snapshot", err)
			return
		}
		digest, err := requestDigest(request)
		if err != nil {
			s.InternalError(r.Context(), w, "digest apply request", err)
			return
		}
		response, ok := sendCommand(s, w, r, commandRequest{
			kind: federationspec.HubApplyKind, orgDID: orgDID,
			opening: request.OpeningNumber, applicant: identity.UserDID,
			key: key, digest: digest,
			payload: federationspec.HubApplyPayload{
				OpeningNumber: request.OpeningNumber,
				ApplicantDID: hubspec.HubUserDID(
					dbvalue.FormatUUID(identity.UserDID),
				),
				CoverNote: request.CoverNote, Snapshot: snapshot,
			},
		})
		if !ok {
			return
		}
		if response.Status != http.StatusCreated {
			writeRejection(s, w, r, response, applyRejections)
			return
		}
		var result federationspec.HubApplyResult
		if err := json.Unmarshal(response.Body, &result); err != nil ||
			result.OpeningNumber != request.OpeningNumber {
			s.InternalError(r.Context(), w, "decode hub-apply result",
				fmt.Errorf("unexpected result: %v", err))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusCreated,
			applicationspec.ApplicationReference{
				Domain: request.Domain, OpeningNumber: result.OpeningNumber,
				ApplicationNumber: result.ApplicationNumber,
			})
	}
}

// applicantSnapshot is the caller's profile view as of now, without the
// picture; professional-email evidence is not part of the view.
func applicantSnapshot(
	ctx context.Context, q sqlc.Querier, did pgtype.UUID,
) (profile.ApplicantSnapshot, error) {
	row, err := q.GetHubPublicProfile(ctx, did)
	if err != nil {
		return profile.ApplicantSnapshot{}, err
	}
	snapshot := profile.ApplicantSnapshot{
		DisplayName:     common.DisplayName(row.DisplayName),
		Handle:          hubspec.HubHandle(row.Handle),
		ResidentCountry: common.CountryCode(row.ResidentCountry),
	}
	if row.ProfileAlias.Valid {
		alias := directoryspec.HubAlias(row.ProfileAlias.String)
		snapshot.ProfileAlias = &alias
	}
	if row.Biography.Valid {
		biography := profile.ProfileLongText(row.Biography.String)
		snapshot.Biography = &biography
	}
	for _, item := range []struct {
		name   string
		data   []byte
		target any
	}{
		{"websites", row.Websites, &snapshot.Websites},
		{"work experiences", row.WorkExperiences, &snapshot.WorkExperiences},
		{"certifications", row.Certifications, &snapshot.Certifications},
		{"language abilities", row.LanguageAbilities, &snapshot.LanguageAbilities},
		{"educational qualifications", row.EducationalQualifications,
			&snapshot.EducationalQualifications},
	} {
		if err := json.Unmarshal(item.data, item.target); err != nil {
			return profile.ApplicantSnapshot{}, fmt.Errorf("decode %s: %w",
				item.name, err)
		}
	}
	return snapshot.Normalized(), nil
}
