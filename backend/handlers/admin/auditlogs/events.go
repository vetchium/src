package auditlogs

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	auditlogs "github.com/vetchium/src/typespec/admin/audit-logs"
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"

	adminruntime "backend/internal/admin"
	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

const auditEventsPaginationPurpose = "admin-list-audit-events-v1"

type auditEventsPaginationPayload struct {
	BeforeCreatedAt time.Time `json:"before_created_at"`
	BeforeEventID   string    `json:"before_event_id"`
	FiltersHash     string    `json:"filters_hash"`
}

func ListAuditEvents(s *adminruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request auditlogs.ListRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		filtersHash, err := auditEventsFiltersHash(request)
		if err != nil {
			s.InternalError(r.Context(), w, "hash audit event filters", err)
			return
		}
		params := sqlc.ListAdminAuditEventsParams{
			PageLimit: int32(request.EffectiveLimit()) + 1,
		}
		start, _ := time.Parse(time.RFC3339Nano, request.StartAt)
		end, _ := time.Parse(time.RFC3339Nano, request.EndAt)
		params.TenantID = s.TenantID
		params.StartAt = dbvalue.Timestamp(start)
		params.EndAt = dbvalue.Timestamp(end)
		params.HubHandle = optionalText(request.HubHandle)
		params.HubEmail = optionalText(request.HubEmail)
		params.OrgDomain = optionalText(request.OrgDomain)
		params.OrgUserEmail = optionalText(request.OrgUserEmail)
		if request.PaginationKey != nil && !applyAuditEventsPaginationKey(
			s, &params, string(*request.PaginationKey), filtersHash,
		) {
			s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			return
		}
		rows, err := s.Queries.ListAdminAuditEvents(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list audit events", err)
			return
		}
		limit := int(request.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := auditlogs.ListResponse{Events: make([]auditlogs.Event, 0, len(rows))}
		for _, row := range rows {
			event := auditlogs.Event{
				AuditEventID: dbvalue.FormatUUID(row.AuditEventID),
				CreatedAt:    row.CreatedAt.Time.UTC(), Action: row.Action,
				EntityType: row.EntityType, ActorType: row.ActorType,
				Source: row.Source, Details: safeDetails(row.Payload),
			}
			if row.ActorName != "" && !strings.Contains(row.ActorName, "@") {
				event.ActorName = &row.ActorName
			}
			response.Events = append(response.Events, event)
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(auditEventsPaginationPayload{
				BeforeCreatedAt: last.CreatedAt.Time.UTC(),
				BeforeEventID: dbvalue.FormatUUID(
					last.AuditEventID,
				),
				FiltersHash: filtersHash,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode pagination key", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"),
				auditEventsPaginationPurpose,
				payload,
			))
			response.NextPaginationKey = &key
		}
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func optionalText[T ~string](value *T) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return dbvalue.Text(string(*value))
}
func auditEventsFiltersHash(request auditlogs.ListRequest) (string, error) {
	request.Limit = nil
	request.PaginationKey = nil
	payload, err := json.Marshal(request)
	if err != nil {
		return "", err
	}
	digest := credentials.CanonicalDigest(payload)
	return base64.RawURLEncoding.EncodeToString(digest[:]), nil
}
func applyAuditEventsPaginationKey(
	s *adminruntime.Server,
	params *sqlc.ListAdminAuditEventsParams,
	key string,
	filtersHash string,
) bool {
	payload, ok := credentials.VerifySignedValue(
		s.CredentialSubkey("pagination"),
		auditEventsPaginationPurpose,
		key,
	)
	if !ok {
		return false
	}
	var decoded auditEventsPaginationPayload
	if json.Unmarshal(payload, &decoded) != nil ||
		decoded.FiltersHash != filtersHash ||
		strings.TrimSpace(decoded.BeforeEventID) == "" ||
		decoded.BeforeCreatedAt.IsZero() {
		return false
	}
	eventID, err := dbvalue.ParseUUID(decoded.BeforeEventID)
	if err != nil {
		return false
	}
	params.BeforeCreatedAt = dbvalue.Timestamp(decoded.BeforeCreatedAt)
	params.BeforeEventID = eventID
	return true
}
