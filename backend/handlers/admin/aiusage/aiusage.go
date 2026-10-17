// Package aiusage holds the Admin API handlers that review an Org's AI usage.
package aiusage

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"

	aiusagespec "github.com/vetchium/src/typespec/admin/ai-usage"
	aispec "github.com/vetchium/src/typespec/orgs/ai"
	"github.com/vetchium/src/typespec/problem"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	adminruntime "backend/internal/admin"
	"backend/internal/aiusage"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
)

const paginationPurpose = "admin-list-org-ai-usage-v1"

func ListOrgAIUsage(s *adminruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request aiusagespec.ListOrgAIUsageRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		orgDID, err := s.Queries.GetOrgDIDForClaimedDomain(
			r.Context(), string(request.OrgDomain),
		)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, adminproblem.OrgNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "find Org by domain", err)
			return
		}
		limit := int(request.EffectiveLimit())
		params := sqlc.ListOrgAIUsageParams{
			OrgDid: orgDID, PageLimit: int32(limit) + 1,
		}
		scope := string(request.OrgDomain)
		if request.PaginationKey != nil {
			after, afterID, valid := aiusage.DecodeCursor(
				s.CredentialSubkey("pagination"), paginationPurpose, scope,
				*request.PaginationKey,
			)
			if !valid {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterCreatedAt, params.AfterUsageID = after, afterID
		}
		rows, err := s.Queries.ListOrgAIUsage(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list Org AI usage", err)
			return
		}
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := aiusagespec.ListOrgAIUsageResponse{
			Entries: make([]aispec.AIUsage, 0, len(rows)),
		}
		for _, row := range rows {
			response.Entries = append(response.Entries, aiusage.Entry(row))
		}
		if hasMore {
			key, err := aiusage.EncodeCursor(
				s.CredentialSubkey("pagination"), paginationPurpose, scope, rows[len(rows)-1],
			)
			if err != nil {
				s.InternalError(r.Context(), w, "encode Org AI usage cursor", err)
				return
			}
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// GetOrgAIUsageText returns kept text and audits the read in the same
// statement, so no text leaves without a record of who read it.
func GetOrgAIUsageText(s *adminruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request aiusagespec.GetOrgAIUsageTextRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		orgDID, err := s.Queries.GetOrgDIDForClaimedDomain(
			r.Context(), string(request.OrgDomain),
		)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, adminproblem.AIUsageNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "find Org by domain", err)
			return
		}
		usageID, err := dbvalue.ParseUUID(string(request.UsageID))
		if err != nil {
			s.Problem(r.Context(), w, adminproblem.AIUsageNotFoundError)
			return
		}
		row, err := s.Queries.ReadOrgAIUsageTextForAdmin(r.Context(),
			sqlc.ReadOrgAIUsageTextForAdminParams{
				UsageID: usageID, OrgDid: orgDID, TenantID: s.TenantID,
				AdminUserID: identity.UserID,
			})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, adminproblem.AIUsageNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read Org AI usage text", err)
			return
		}
		if row.AuditCount != 1 {
			s.InternalError(r.Context(), w, "read Org AI usage text",
				fmt.Errorf("unaudited AI usage text read"))
			return
		}
		text, err := aiusage.Text(
			string(request.UsageID), row.RequestMessages, row.ResponseText,
			row.ExpiresAt,
		)
		if err != nil {
			s.InternalError(r.Context(), w, "decode Org AI usage text", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, text)
	}
}
