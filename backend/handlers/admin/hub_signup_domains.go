package admin

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	adminspec "github.com/vetchium/src/typespec/admin"
	hubsignupdomains "github.com/vetchium/src/typespec/admin/hub-signup-domains"
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
)

const hubSignupDomainsPaginationPurpose = "admin-list-hub-signup-domains-v1"

type hubSignupDomainsPaginationPayload struct {
	BeforeCreatedAt time.Time `json:"before_created_at"`
	BeforeDomainID  string    `json:"before_domain_id"`
	FiltersHash     string    `json:"filters_hash"`
}

func ListHubSignupDomains(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubsignupdomains.ListRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			request = request.Normalize()
			return request.Validate()
		}) {
			return
		}
		filtersHash, err := hubSignupDomainsFiltersHash(request)
		if err != nil {
			s.InternalError(r.Context(), w, "hash Hub signup domain filters", err)
			return
		}
		params := sqlc.ListHubSignupDomainsParams{
			PageLimit: int32(request.EffectiveLimit()) + 1,
		}
		if request.FilterSearch != nil {
			params.FilterSearch = dbvalue.Text(string(*request.FilterSearch))
		}
		if request.FilterState != nil {
			params.FilterState = sqlc.NullVetchiumHubSignupDomainState{
				VetchiumHubSignupDomainState: sqlc.VetchiumHubSignupDomainState(
					*request.FilterState,
				),
				Valid: true,
			}
		}
		if request.PaginationKey != nil && !applyHubSignupDomainsPaginationKey(
			s, &params, string(*request.PaginationKey), filtersHash,
		) {
			s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			return
		}
		rows, err := s.Queries.ListHubSignupDomains(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list Hub signup domains", err)
			return
		}
		limit := int(request.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := hubsignupdomains.ListResponse{
			Domains: make([]hubsignupdomains.Domain, 0, len(rows)),
		}
		for _, row := range rows {
			response.Domains = append(response.Domains, hubSignupDomain(
				row.HubSignupDomainID,
				row.Domain,
				row.HubSignupDomainState,
				row.DisabledComment,
				row.CreatedAt,
				row.UpdatedAt,
			))
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(hubSignupDomainsPaginationPayload{
				BeforeCreatedAt: last.CreatedAt.Time.UTC(),
				BeforeDomainID: dbvalue.FormatUUID(
					last.HubSignupDomainID,
				),
				FiltersHash: filtersHash,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode pagination key", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"),
				hubSignupDomainsPaginationPurpose,
				payload,
			))
			response.NextPaginationKey = &key
		}
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func CreateHubSignupDomain(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubsignupdomains.CreateRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			request = request.Normalize()
			return request.Validate()
		}) {
			return
		}
		domainID, err := dbvalue.NewUUID()
		if err != nil {
			s.InternalError(r.Context(), w, "create Hub signup domain ID", err)
			return
		}
		row, err := s.Queries.CreateHubSignupDomain(
			r.Context(), sqlc.CreateHubSignupDomainParams{
				HubSignupDomainID: domainID,
				Domain:            string(request.Domain),
				State: sqlc.VetchiumHubSignupDomainState(
					request.EffectiveState(),
				),
				DisabledComment: hubSignupDomainCommentParam(
					request.DisabledComment,
				),
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "create Hub signup domain", err)
			return
		}
		if row.Result == "already_exists" {
			s.Problem(
				r.Context(), w,
				adminproblem.HubSignupDomainAlreadyExistsError,
			)
			return
		}
		s.JSON(r.Context(), w, http.StatusCreated, hubSignupDomain(
			row.HubSignupDomainID,
			row.Domain,
			row.HubSignupDomainState,
			row.DisabledComment,
			row.CreatedAt,
			row.UpdatedAt,
		))
	}
}

func UpdateHubSignupDomain(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubsignupdomains.UpdateRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			request = request.Normalize()
			return request.Validate()
		}) {
			return
		}
		domainID, _ := dbvalue.ParseUUID(string(request.HubSignupDomainID))
		row, err := s.Queries.UpdateHubSignupDomain(
			r.Context(), sqlc.UpdateHubSignupDomainParams{
				TargetDomainID: domainID,
				TargetDomain:   string(request.Domain),
				State: sqlc.VetchiumHubSignupDomainState(
					request.State,
				),
				DisabledComment: hubSignupDomainCommentParam(
					request.DisabledComment,
				),
			},
		)
		if err != nil {
			if isHubSignupDomainConflict(err) {
				s.Problem(
					r.Context(), w,
					adminproblem.HubSignupDomainAlreadyExistsError,
				)
				return
			}
			s.InternalError(r.Context(), w, "update Hub signup domain", err)
			return
		}
		switch row.Result {
		case "not_found":
			s.Problem(
				r.Context(), w,
				adminproblem.HubSignupDomainNotFoundError,
			)
			return
		case "already_exists":
			s.Problem(
				r.Context(), w,
				adminproblem.HubSignupDomainAlreadyExistsError,
			)
			return
		}
		s.JSON(r.Context(), w, http.StatusOK, hubSignupDomain(
			row.HubSignupDomainID,
			row.Domain,
			row.HubSignupDomainState,
			row.DisabledComment,
			row.CreatedAt,
			row.UpdatedAt,
		))
	}
}

func isHubSignupDomainConflict(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) &&
		databaseError.Code == "23505" &&
		databaseError.ConstraintName == "hub_signup_domains_domain_key"
}

func hubSignupDomain(
	domainID pgtype.UUID,
	domain string,
	state sqlc.VetchiumHubSignupDomainState,
	disabledComment string,
	createdAt pgtype.Timestamptz,
	updatedAt pgtype.Timestamptz,
) hubsignupdomains.Domain {
	result := hubsignupdomains.Domain{
		HubSignupDomainID: adminspec.HubSignupDomainID(
			dbvalue.FormatUUID(domainID),
		),
		Domain:    hubsignupdomains.DomainName(domain),
		State:     hubsignupdomains.State(state),
		CreatedAt: createdAt.Time.UTC(),
		UpdatedAt: updatedAt.Time.UTC(),
	}
	if disabledComment != "" {
		comment := hubsignupdomains.DisableComment(disabledComment)
		result.DisabledComment = &comment
	}
	return result
}

func hubSignupDomainCommentParam(
	comment *hubsignupdomains.DisableComment,
) pgtype.Text {
	if comment == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: string(*comment), Valid: true}
}

func hubSignupDomainsFiltersHash(
	request hubsignupdomains.ListRequest,
) (string, error) {
	payload, err := json.Marshal(struct {
		Search *hubsignupdomains.DomainFilterText `json:"search"`
		State  *hubsignupdomains.State            `json:"state"`
	}{
		Search: request.FilterSearch,
		State:  request.FilterState,
	})
	if err != nil {
		return "", err
	}
	digest := credentials.CanonicalDigest(payload)
	return base64.RawURLEncoding.EncodeToString(digest[:]), nil
}

func applyHubSignupDomainsPaginationKey(
	s *adminapi.Server,
	params *sqlc.ListHubSignupDomainsParams,
	key string,
	filtersHash string,
) bool {
	payload, ok := credentials.VerifySignedValue(
		s.CredentialSubkey("pagination"),
		hubSignupDomainsPaginationPurpose,
		key,
	)
	if !ok {
		return false
	}
	var decoded hubSignupDomainsPaginationPayload
	if json.Unmarshal(payload, &decoded) != nil ||
		decoded.FiltersHash != filtersHash ||
		strings.TrimSpace(decoded.BeforeDomainID) == "" ||
		decoded.BeforeCreatedAt.IsZero() {
		return false
	}
	domainID, err := dbvalue.ParseUUID(decoded.BeforeDomainID)
	if err != nil {
		return false
	}
	params.BeforeCreatedAt = dbvalue.Timestamp(decoded.BeforeCreatedAt)
	params.BeforeDomainID = domainID
	return true
}
