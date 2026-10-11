package openings

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/openings"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	"backend/internal/orgs/entitlements"
)

const (
	openingsPaginationPurpose = "orgs-list-openings-v1"
	historyPaginationPurpose  = "orgs-opening-history-v1"
)

func loadOpening(
	ctx context.Context, q sqlc.Querier, identity middleware.OrgIdentity,
	number openings.OpeningNumber,
) (openings.OrgOpening, error) {
	return loadOpeningWithRequester(ctx, q, identity, number, false)
}

func loadOpeningWithRequester(
	ctx context.Context, q sqlc.Querier, identity middleware.OrgIdentity,
	number openings.OpeningNumber, includeRequester bool,
) (openings.OrgOpening, error) {
	data, err := q.GetOrgOpening(ctx, sqlc.GetOrgOpeningParams{
		OrgDid: identity.OrgDID, OpeningNumber: int32(number),
		ViewerID: identity.UserID, IncludeRequester: includeRequester,
	})
	if err != nil {
		return openings.OrgOpening{}, err
	}
	var result openings.OrgOpening
	if err := json.Unmarshal(data, &result); err != nil {
		return openings.OrgOpening{}, fmt.Errorf("decode Org Opening: %w", err)
	}
	return result, nil
}

func GetOpening(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.GetOpeningRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		result, err := loadOpening(r.Context(), s.Queries, identity, request.OpeningNumber)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.OpeningNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Org Opening", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

type openingsCursor struct {
	AfterUpdatedAt     time.Time `json:"after_updated_at"`
	AfterOpeningNumber int32     `json:"after_opening_number"`
	FiltersHash        string    `json:"filters_hash"`
}

func openingFiltersHash(request openings.ListOpeningsRequest) (string, error) {
	request.PaginationKey = nil
	request.Limit = nil
	data, err := json.Marshal(request)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

func optionalEmail(value *common.EmailAddress) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return dbvalue.Text(string(*value))
}

func ListOpenings(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.ListOpeningsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		filtersHash, err := openingFiltersHash(request)
		if err != nil {
			s.InternalError(r.Context(), w, "hash Opening filters", err)
			return
		}
		params := sqlc.ListOrgOpeningsParams{
			OrgDid:             identity.OrgDID,
			ViewerID:           identity.UserID,
			HiringManagerEmail: optionalEmail(request.HiringManagerEmail),
			RecruiterEmail:     optionalEmail(request.RecruiterEmail),
			PageLimit:          int32(request.EffectiveLimit()) + 1,
		}
		if request.States != nil {
			params.States = make([]string, len(request.States))
			for index, state := range request.States {
				params.States[index] = string(state)
			}
		}
		if request.PendingRequestKinds != nil {
			params.PendingRequestKinds = make([]string, len(request.PendingRequestKinds))
			for index, kind := range request.PendingRequestKinds {
				params.PendingRequestKinds[index] = string(kind)
			}
		}
		if request.AwaitingMyApproval != nil {
			params.AwaitingMyApproval = *request.AwaitingMyApproval
		}
		if request.EmployingCountry != nil {
			params.EmployingCountry = dbvalue.Text(string(*request.EmployingCountry))
		}
		if request.WorkArrangement != nil {
			params.WorkArrangement = dbvalue.Text(string(*request.WorkArrangement))
		}
		if request.EmploymentType != nil {
			params.EmploymentType = dbvalue.Text(string(*request.EmploymentType))
		}
		if request.TitleQuery != nil {
			params.TitleQuery = dbvalue.Text(string(*request.TitleQuery))
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), openingsPaginationPurpose,
				string(*request.PaginationKey),
			)
			var cursor openingsCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				cursor.FiltersHash != filtersHash || cursor.AfterUpdatedAt.IsZero() ||
				cursor.AfterOpeningNumber < 1 {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterUpdatedAt = dbvalue.Timestamp(cursor.AfterUpdatedAt)
			params.AfterOpeningNumber = pgtype.Int4{Int32: cursor.AfterOpeningNumber, Valid: true}
		}
		rows, err := s.Queries.ListOrgOpenings(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list Org Openings", err)
			return
		}
		limit := int(request.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := openings.ListOpeningsResponse{Openings: make([]openings.OrgOpeningSummary, 0, len(rows))}
		for _, row := range rows {
			item := openings.OrgOpeningSummary{
				OpeningNumber: openings.OpeningNumber(row.OpeningNumber),
				State:         openings.OpeningState(row.OpeningState),
				UpdatedAt:     row.UpdatedAt.Time.UTC(),
				ExpiresAt:     dbvalue.TimePtr(row.ExpiresAt),
			}
			if row.Title.Valid {
				item.Title = &row.Title.String
			}
			if row.EmployingCountry.Valid {
				value := common.CountryCode(row.EmployingCountry.String)
				item.EmployingCountry = &value
			}
			if row.WorkArrangement.Valid {
				value := common.OpeningWorkArrangement(row.WorkArrangement.VetchiumOrgOpeningWorkArrangement)
				item.WorkArrangement = &value
			}
			if row.EmploymentType.Valid {
				value := common.OpeningEmploymentType(row.EmploymentType.VetchiumOrgOpeningEmploymentType)
				item.EmploymentType = &value
			}
			if row.HiringManagerEmail.Valid {
				value := common.EmailAddress(row.HiringManagerEmail.String)
				item.HiringManagerEmail = &value
			}
			if row.RecruiterEmail.Valid {
				value := common.EmailAddress(row.RecruiterEmail.String)
				item.RecruiterEmail = &value
			}
			if row.PendingRequestKind.Valid {
				value := openings.OpeningRequestKind(row.PendingRequestKind.VetchiumOrgOpeningRequestKind)
				item.PendingRequestKind = &value
			}
			response.Openings = append(response.Openings, item)
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(openingsCursor{
				AfterUpdatedAt:     last.UpdatedAt.Time.UTC(),
				AfterOpeningNumber: last.OpeningNumber,
				FiltersHash:        filtersHash,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode Opening cursor", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), openingsPaginationPurpose, payload))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func OpeningSummary(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.OpeningSummaryRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		windowStart := entitlements.WindowStart(s.CurrentTime())
		row, err := s.Queries.GetOrgOpeningSummary(r.Context(), sqlc.GetOrgOpeningSummaryParams{
			OrgDid: identity.OrgDID, ViewerID: identity.UserID,
			WindowStart: dbvalue.Timestamp(windowStart),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.OpeningNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Opening summary", err)
			return
		}
		counts := []openings.OpeningStateCount{}
		if err := json.Unmarshal(row.Counts, &counts); err != nil {
			s.InternalError(r.Context(), w, "decode Opening counts", err)
			return
		}
		byState := map[openings.OpeningState]int32{}
		for _, count := range counts {
			byState[count.State] = count.Count
		}
		allStates := []openings.OpeningState{openings.Draft, openings.Discarded, openings.Published, openings.Paused, openings.Closed, openings.Expired}
		response := openings.OpeningSummaryResponse{
			Counts: make([]openings.OpeningStateCount, 0, len(allStates)),
			Quota: openings.OpeningQuotaUsage{
				Limit: int32(entitlements.OpeningQuota(subscriptionspec.PlanOID(row.OrgPlanOid))),
				Used:  row.Used, WindowStart: windowStart,
			},
		}
		for _, state := range allStates {
			response.Counts = append(response.Counts, openings.OpeningStateCount{State: state, Count: byState[state]})
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

type historyCursor struct {
	AfterCreatedAt time.Time              `json:"after_created_at"`
	AfterHistoryID string                 `json:"after_history_id"`
	OpeningNumber  openings.OpeningNumber `json:"opening_number"`
}

func ListOpeningHistory(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openings.ListOpeningHistoryRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		params := sqlc.ListOrgOpeningHistoryParams{
			OrgDid: identity.OrgDID, ViewerID: identity.UserID,
			OpeningNumber: int32(request.OpeningNumber),
			PageLimit:     int32(request.EffectiveLimit()) + 1,
		}
		if request.PaginationKey != nil {
			payload, valid := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), historyPaginationPurpose,
				string(*request.PaginationKey))
			var cursor historyCursor
			if !valid || json.Unmarshal(payload, &cursor) != nil ||
				cursor.OpeningNumber != request.OpeningNumber || cursor.AfterCreatedAt.IsZero() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			id, err := dbvalue.ParseUUID(cursor.AfterHistoryID)
			if err != nil {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterCreatedAt = dbvalue.Timestamp(cursor.AfterCreatedAt)
			params.AfterHistoryID = id
		}
		rows, err := s.Queries.ListOrgOpeningHistory(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list Opening history", err)
			return
		}
		if len(rows) == 0 && request.PaginationKey == nil {
			// Creation always writes the first history entry in the same transaction.
			s.Problem(r.Context(), w, orgsproblem.OpeningNotFoundError)
			return
		}
		limit := int(request.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := openings.ListOpeningHistoryResponse{Entries: make([]openings.OpeningHistoryEntry, 0, len(rows))}
		for _, row := range rows {
			var entry openings.OpeningHistoryEntry
			if err := json.Unmarshal(row.Body, &entry); err != nil {
				s.InternalError(r.Context(), w, "decode Opening history", err)
				return
			}
			response.Entries = append(response.Entries, entry)
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(historyCursor{
				AfterCreatedAt: last.CreatedAt.Time.UTC(),
				AfterHistoryID: dbvalue.FormatUUID(last.OrgOpeningHistoryID),
				OpeningNumber:  request.OpeningNumber,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode Opening history cursor", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), historyPaginationPurpose, payload))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
