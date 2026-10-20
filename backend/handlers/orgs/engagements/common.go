// Package engagements serves the Org marketplace engagements. A consumer acts
// on its own authoritative record; a provider acts through durable commands
// to the consumer's tenant and reads its own tenant's projection
// (agent-guides/marketplace.md, MKT-GEN-004 and MKT-GEN-005).
package engagements

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/engagements"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

const (
	consumerListPurpose = "orgs-list-engagements-v1"
	providerListPurpose = "orgs-list-client-engagements-v1"
)

// listFilters are the normalized filters a pagination key is bound to.
type listFilters struct {
	State      string `json:"state,omitempty"`
	Capability string `json:"capability,omitempty"`
}

type listCursor struct {
	Filters listFilters `json:"filters"`
	Rank    int16       `json:"rank"`
	At      time.Time   `json:"at"`
	ID      string      `json:"id"`
}

func filtersOf(request marketplace.ListEngagementsRequest) listFilters {
	var filters listFilters
	if request.State != nil {
		filters.State = string(*request.State)
	}
	if request.Capability != nil {
		filters.Capability = string(*request.Capability)
	}
	return filters
}

// list serves both sides' lists: query reads one page of stored fields for
// the caller's Org, and side picks the view and the key's purpose.
func list(
	s *orgsruntime.Server, side marketplace.EngagementParty,
	query func(*http.Request, sqlc.ListConsumerEngagementsParams) ([]engagements.Fields, error),
) http.HandlerFunc {
	purpose := consumerListPurpose
	if side == marketplace.ProviderParty {
		purpose = providerListPurpose
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var request marketplace.ListEngagementsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		limit := int(request.EffectiveLimit())
		filters := filtersOf(request)
		params := sqlc.ListConsumerEngagementsParams{
			OrgDid: identity.OrgDID, PageLimit: int32(limit) + 1,
			State:         dbvalue.NullText(ptrIf(filters.State)),
			CapabilityOid: dbvalue.NullText(ptrIf(filters.Capability)),
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), purpose, string(*request.PaginationKey))
			var cursor listCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				cursor.Filters != filters {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			id, err := dbvalue.ParseUUID(cursor.ID)
			if err != nil {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterID = id
			params.AfterRank = pgtype.Int2{Int16: cursor.Rank, Valid: true}
			params.AfterAt = dbvalue.Timestamp(cursor.At)
		}
		rows, err := query(r, params)
		if err != nil {
			s.InternalError(r.Context(), w, "list engagements", err)
			return
		}
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := marketplace.ListEngagementsResponse{
			Engagements: make([]marketplace.Engagement, 0, len(rows)),
		}
		for _, row := range rows {
			response.Engagements = append(response.Engagements,
				engagements.Snapshot(row).ViewFor(side))
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(listCursor{
				Filters: filters, Rank: last.StateRank.Int16,
				At: last.ProposedAt.Time.UTC(), ID: dbvalue.FormatUUID(last.EngagementID),
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode engagement cursor", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), purpose, payload))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func ptrIf(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
