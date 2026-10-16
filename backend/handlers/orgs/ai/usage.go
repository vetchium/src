package ai

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	aispec "github.com/vetchium/src/typespec/orgs/ai"
	"github.com/vetchium/src/typespec/orgs/authorization"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/aiusage"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgai "backend/internal/orgs/ai"
)

const usagePaginationPurpose = "orgs:ai-usage"

func ListAIUsage(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request aispec.ListAIUsageRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		limit := int(request.EffectiveLimit())
		params := sqlc.ListOrgAIUsageParams{
			OrgDid: identity.OrgDID, PageLimit: int32(limit) + 1,
		}
		if request.PaginationKey != nil {
			after, afterID, valid := aiusage.DecodeCursor(
				s.CredentialSubkey("pagination"), usagePaginationPurpose, "",
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
			s.InternalError(r.Context(), w, "list AI usage", err)
			return
		}
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := aispec.ListAIUsageResponse{
			Entries: make([]aispec.AIUsage, 0, len(rows)),
		}
		for _, row := range rows {
			response.Entries = append(response.Entries, aiusage.Entry(row))
		}
		if hasMore {
			key, err := aiusage.EncodeCursor(
				s.CredentialSubkey("pagination"), usagePaginationPurpose, "",
				rows[len(rows)-1],
			)
			if err != nil {
				s.InternalError(r.Context(), w, "encode AI usage cursor", err)
				return
			}
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// GetAIUsageText answers not found unless the caller may also read what the
// operation worked on, so a prompt holding hiring data reaches nobody who
// could not read that data directly.
func GetAIUsageText(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request aispec.GetAIUsageTextRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		usageID, err := dbvalue.ParseUUID(string(request.UsageID))
		if err != nil {
			s.Problem(r.Context(), w, orgsproblem.AIUsageNotFoundError)
			return
		}
		row, err := s.Queries.GetOrgAIUsageText(r.Context(), sqlc.GetOrgAIUsageTextParams{
			UsageID: usageID, OrgDid: identity.OrgDID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.AIUsageNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get AI usage text", err)
			return
		}
		required, known := orgai.TextReadPermission(
			aispec.AIOperationOID(row.Operation),
		)
		if !known || !authorization.Holds(effective(identity), required) {
			s.Problem(r.Context(), w, orgsproblem.AIUsageNotFoundError)
			return
		}
		text, err := aiusage.Text(
			string(request.UsageID), row.RequestMessages, row.ResponseText,
			row.ExpiresAt,
		)
		if err != nil {
			s.InternalError(r.Context(), w, "decode AI usage text", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, text)
	}
}
