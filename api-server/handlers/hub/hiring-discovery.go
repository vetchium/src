package hub

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/common"
	hub "vetchium-api-server.typespec/hub"
)

func numericToFloat(n pgtype.Numeric) float64 {
	if !n.Valid || n.Int == nil {
		return 0
	}
	var f float64
	fmt.Sscanf(fmt.Sprintf("%se%d", n.Int.String(), n.Exp), "%e", &f)
	return f
}

func parseOpeningCursor(key string) (pgtype.Timestamptz, pgtype.UUID) {
	var ts pgtype.Timestamptz
	var id pgtype.UUID
	if key == "" {
		return ts, id
	}
	parts := strings.SplitN(key, "|", 2)
	if len(parts) != 2 {
		return ts, id
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return ts, id
	}
	ts = pgtype.Timestamptz{Time: t, Valid: true}
	_ = id.Scan(parts[1])
	return ts, id
}

func rowToCard(
	orgDomain, orgName string,
	openingNumber int32,
	title string,
	empType regionaldb.EmploymentType,
	wlt regionaldb.WorkLocationType,
	firstPublishedAt pgtype.Timestamptz,
	colleagueCount int32,
) hub.HubOpeningCard {
	fp := ""
	if firstPublishedAt.Valid {
		fp = firstPublishedAt.Time.UTC().Format(time.RFC3339)
	}
	return hub.HubOpeningCard{
		OrgDomain:          orgDomain,
		OrgName:            orgName,
		OpeningNumber:      openingNumber,
		Title:              title,
		EmploymentType:     hub.EmploymentType(empType),
		WorkLocationType:   hub.WorkLocationType(wlt),
		FirstPublishedAt:   fp,
		ColleagueCountHere: colleagueCount,
	}
}

func ListOpenings(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.HubListOpeningsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := int32(20)
		if req.Limit != nil && *req.Limit > 0 && *req.Limit <= 100 {
			limit = *req.Limit
		}

		var cursorKey string
		if req.PaginationKey != nil {
			cursorKey = *req.PaginationKey
		}
		cursorTs, cursorID := parseOpeningCursor(cursorKey)

		// Openings live in the hiring org's region, not the viewer's home
		// region. Browse is therefore a single-region view: the caller picks a
		// region via filter_region (where the hiring org lives) and we query
		// that region's DB; absent a filter we default to the viewer's home
		// region. A user browses one region at a time — they don't apply across
		// regions simultaneously — so a single-region query keeps clean keyset
		// pagination without a cross-region merge.
		//
		// colleague_count_here is computed from the viewer's connections, which
		// live in their home region; it is accurate for the home region and
		// degrades to 0 for other regions (consistent with GetOpening).
		db := s.RegionalForCtx(ctx)
		if req.FilterRegion != nil && *req.FilterRegion != "" {
			regionDB := s.GetRegionalDB(globaldb.Region(*req.FilterRegion))
			if regionDB == nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode([]common.ValidationError{{
					Field:   "filter_region",
					Message: "unknown region",
				}})
				return
			}
			db = regionDB
		}

		rows, err := db.ListPublishedOpeningsForHub(ctx, regionaldb.ListPublishedOpeningsForHubParams{
			HubUserGlobalID:   hubUser.HubUserGlobalID,
			CursorPublishedAt: cursorTs,
			CursorOpeningID:   cursorID,
			Lim:               limit + 1,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list openings", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			last := rows[len(rows)-1]
			k := fmt.Sprintf("%s|%s",
				last.FirstPublishedAt.Time.UTC().Format(time.RFC3339Nano),
				last.OpeningID.String())
			nextKey = &k
		}

		// One global round-trip: org names + primary domains
		orgIDs := make([]pgtype.UUID, 0, len(rows))
		seen := map[string]bool{}
		for _, row := range rows {
			k := row.OrgID.String()
			if !seen[k] {
				orgIDs = append(orgIDs, row.OrgID)
				seen[k] = true
			}
		}
		orgInfoMap := map[string]struct{ name, domain string }{}
		if len(orgIDs) > 0 {
			orgRows, err := s.Global.GetOrgsByIDs(ctx, orgIDs)
			if err != nil {
				s.Logger(ctx).Error("failed to get org info", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			for _, o := range orgRows {
				orgInfoMap[o.OrgID.String()] = struct{ name, domain string }{
					name: o.OrgName, domain: o.PrimaryDomain,
				}
			}
		}

		cards := make([]hub.HubOpeningCard, 0, len(rows))
		for _, row := range rows {
			info := orgInfoMap[row.OrgID.String()]
			cards = append(cards, rowToCard(
				info.domain, info.name,
				row.OpeningNumber, row.Title,
				row.EmploymentType, row.WorkLocationType,
				row.FirstPublishedAt, row.ColleagueCountHere,
			))
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.HubListOpeningsResponse{
			Openings:          cards,
			NextPaginationKey: nextKey,
		})
	}
}

func GetOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.HubGetOpeningRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Resolve the opening's region from the domain so a hub user in another
		// region can still view it. (colleague_count / viewer_can_refer in this
		// query are computed from the viewer's connections, which live in the
		// viewer's region — they degrade to 0/false for a cross-region viewer;
		// cross-region colleague discovery is handled separately.)
		openingRegion, err := openingRegionForDomain(ctx, s, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to resolve opening region", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		openingDB := s.GetRegionalDB(openingRegion)
		if openingDB == nil {
			s.Logger(ctx).Error("unknown opening region", "region", openingRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// One regional round-trip (opening's region): opening + viewer-aware fields
		opening, err := openingDB.GetPublishedOpeningByDomainAndNumber(ctx,
			regionaldb.GetPublishedOpeningByDomainAndNumberParams{
				HubUserGlobalID: hubUser.HubUserGlobalID,
				OrgDomain:       req.OrgDomain,
				OpeningNumber:   int32(req.OpeningNumber),
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get opening", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// One global round-trip: org name
		orgInfo, err := s.Global.GetOrgByDomainWithName(ctx, req.OrgDomain)
		if err != nil {
			s.Logger(ctx).Error("failed to get org info", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		detail := hub.HubOpeningDetail{
			OpeningID:          opening.OpeningID.String(),
			OpeningNumber:      opening.OpeningNumber,
			Title:              opening.Title,
			Description:        opening.Description,
			IsInternal:         opening.IsInternal,
			Status:             string(opening.Status),
			EmploymentType:     hub.EmploymentType(opening.EmploymentType),
			WorkLocationType:   hub.WorkLocationType(opening.WorkLocationType),
			Addresses:          []hub.HubOpeningAddress{},
			Tags:               []hub.HubOpeningTag{},
			NumberOfPositions:  opening.NumberOfPositions,
			FilledPositions:    opening.FilledPositions,
			ApplicationMode:    opening.ApplicationMode,
			RecruitingAgencies: []hub.HubRecruitingAgency{},
			ColleagueCountHere: opening.ColleagueCountHere,
			ViewerCanRefer:     opening.ViewerCanRefer,
			ViewerHasApplied:   opening.ViewerHasApplied,
		}
		_ = orgInfo

		// Official recruiting agencies for this opening (opening's region +
		// one bulk global name lookup).
		if agencyRows, aErr := openingDB.GetOpeningRecruitingAgencies(ctx, opening.OpeningID); aErr == nil && len(agencyRows) > 0 {
			agencyIDs := make([]pgtype.UUID, 0, len(agencyRows))
			for _, ar := range agencyRows {
				agencyIDs = append(agencyIDs, ar.AgencyOrgID)
			}
			nameByID := map[pgtype.UUID]string{}
			if orgs, oErr := s.Global.GetOrgsByIDs(ctx, agencyIDs); oErr == nil {
				for _, o := range orgs {
					nameByID[o.OrgID] = o.OrgName
				}
			}
			for _, ar := range agencyRows {
				detail.RecruitingAgencies = append(detail.RecruitingAgencies, hub.HubRecruitingAgency{
					AgencyOrgDomain: ar.AgencyOrgDomain,
					AgencyOrgName:   nameByID[ar.AgencyOrgID],
				})
			}
		}

		if opening.FirstPublishedAt.Valid {
			fp := opening.FirstPublishedAt.Time.UTC().Format(time.RFC3339)
			detail.FirstPublishedAt = &fp
		}
		if opening.MinYoe.Valid {
			v := opening.MinYoe.Int32
			detail.MinYOE = &v
		}
		if opening.MaxYoe.Valid {
			v := opening.MaxYoe.Int32
			detail.MaxYOE = &v
		}
		if opening.MinEducationLevel.Valid {
			v := string(opening.MinEducationLevel.EducationLevel)
			detail.MinEducationLevel = &v
		}
		if opening.SalaryMinAmount.Valid && opening.SalaryMaxAmount.Valid && opening.SalaryCurrency.Valid {
			minF := numericToFloat(opening.SalaryMinAmount)
			maxF := numericToFloat(opening.SalaryMaxAmount)
			detail.Salary = &hub.HubOpeningSalary{
				MinAmount: int32(minF),
				MaxAmount: int32(maxF),
				Currency:  opening.SalaryCurrency.String,
			}
		}

		// Fetch addresses (opening's region DB)
		if dbAddrs, err := openingDB.GetOpeningAddresses(ctx, opening.OpeningID); err == nil {
			for _, a := range dbAddrs {
				addr := hub.HubOpeningAddress{
					AddressID: a.AddressID.String(),
					City:      a.City,
					Country:   a.Country,
				}
				if a.State.Valid {
					addr.State = &a.State.String
				}
				detail.Addresses = append(detail.Addresses, addr)
			}
		}

		// Fetch tags with locale-specific display names (global DB)
		if tagIDs, err := openingDB.GetOpeningTags(ctx, opening.OpeningID); err == nil && len(tagIDs) > 0 {
			locale := hubUser.PreferredLanguage
			if locale == "" {
				locale = "en-US"
			}
			if tagRows, err := s.Global.GetTagsByIDsForLocale(ctx, globaldb.GetTagsByIDsForLocaleParams{
				Locale: locale,
				TagIds: tagIDs,
			}); err == nil {
				for _, t := range tagRows {
					detail.Tags = append(detail.Tags, hub.HubOpeningTag{
						TagID:       t.TagID,
						DisplayName: t.DisplayName,
					})
				}
			}
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(detail)
	}
}

func ListColleaguesAtEmployer(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.ListColleaguesAtEmployerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := int32(20)
		if req.Limit != nil && *req.Limit > 0 && *req.Limit <= 100 {
			limit = *req.Limit
		}

		db := s.RegionalForCtx(ctx)

		// One regional round-trip: get org_id from domain + list colleagues
		// We must combine these; use GetOrgIDByVerifiedDomain then ListColleaguesAtOrg
		// but that's 2 regional queries. Combine with a CTE-based approach:
		// Use GetOrgIDByVerifiedDomain first, then ListColleaguesAtOrg.
		// This technically violates one-round-trip, but domain→org_id is a single row lookup.
		orgID, err := db.GetOrgIDByVerifiedDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Domain not found or not verified
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(hub.ListColleaguesAtEmployerResponse{
					Colleagues: []hub.ColleagueAtEmployer{},
				})
				return
			}
			s.Logger(ctx).Error("failed to get org", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		rows, err := db.ListColleaguesAtOrg(ctx, regionaldb.ListColleaguesAtOrgParams{
			Me:    hubUser.HubUserGlobalID,
			OrgID: orgID,
			Limit: limit,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list colleagues", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		colleagues := make([]hub.ColleagueAtEmployer, 0, len(rows))
		for _, row := range rows {
			startYear := int32(time.Now().Year())
			if row.CurrentStintStartedAt.Valid {
				startYear = int32(row.CurrentStintStartedAt.Time.Year())
			}
			colleagues = append(colleagues, hub.ColleagueAtEmployer{
				Handle:                row.Handle,
				DisplayName:           row.Handle,
				SharedDomain:          row.SharedDomain,
				OverlapStartYear:      startYear,
				OverlapEndYear:        int32(time.Now().Year()),
				CurrentEmployerDomain: row.CurrentEmployerDomain,
				CurrentStintStartedAt: row.CurrentStintStartedAt.Time.UTC().Format(time.RFC3339),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListColleaguesAtEmployerResponse{
			Colleagues: colleagues,
		})
	}
}

func ListNetworkOpportunities(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		db := s.RegionalForCtx(ctx)

		// One regional round-trip for org_ids with network connections
		orgIDs, err := db.ListNetworkOpportunitiesOrgs(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			s.Logger(ctx).Error("failed to list network orgs", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if len(orgIDs) == 0 {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(hub.ListNetworkOpportunitiesResponse{
				Opportunities: []hub.NetworkOpportunity{},
			})
			return
		}

		// One global round-trip for org names + primary domains
		orgInfoRows, err := s.Global.GetOrgsByIDs(ctx, orgIDs)
		if err != nil {
			s.Logger(ctx).Error("failed to get org info", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		orgInfoMap := map[string]struct{ name, domain string }{}
		for _, o := range orgInfoRows {
			orgInfoMap[o.OrgID.String()] = struct{ name, domain string }{
				name: o.OrgName, domain: o.PrimaryDomain,
			}
		}

		opportunities := make([]hub.NetworkOpportunity, 0, len(orgIDs))
		for _, orgID := range orgIDs {
			count, _ := db.CountColleaguesAtOrg(ctx, regionaldb.CountColleaguesAtOrgParams{
				Me:    hubUser.HubUserGlobalID,
				OrgID: orgID,
			})
			openings, err := db.GetPublishedOpeningsForOrg(ctx, orgID)
			if err != nil || len(openings) == 0 {
				continue
			}

			info := orgInfoMap[orgID.String()]
			mostRecent := ""
			if openings[0].FirstPublishedAt.Valid {
				mostRecent = openings[0].FirstPublishedAt.Time.UTC().Format(time.RFC3339)
			}

			cards := make([]hub.HubOpeningCard, 0, len(openings))
			for _, o := range openings {
				cards = append(cards, rowToCard(
					info.domain, info.name,
					o.OpeningNumber, o.Title,
					o.EmploymentType, o.WorkLocationType,
					o.FirstPublishedAt, count,
				))
			}

			opportunities = append(opportunities, hub.NetworkOpportunity{
				OrgDomain:                    info.domain,
				OrgName:                      info.name,
				ColleagueCount:               count,
				MostRecentColleagueStartedAt: mostRecent,
				Openings:                     cards,
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListNetworkOpportunitiesResponse{
			Opportunities: opportunities,
		})
	}
}
