package org

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/org"
)

const (
	defaultOpeningLimit = 20
	maxOpeningLimit     = 100
)

// CreateOpening handles POST /org/create-opening
func CreateOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.CreateOpeningRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Validate references exist and belong to this org
		if err := validateOpeningReferences(ctx, s, orgUser.OrgID, &req); err != nil {
			log.Debug("validation failed", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode([]map[string]string{{
				"field":   "references",
				"message": err.Error(),
			}})
			return
		}

		// Validate distinctness of hiring manager, recruiter, and hiring team members
		if err := validateDistinctTeam(&req); err != nil {
			log.Debug("validation failed", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode([]map[string]string{{
				"field":   "hiring_team",
				"message": err.Error(),
			}})
			return
		}

		var opening regionaldb.Opening
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Allocate opening number
			allocated, err := qtx.AllocateOpeningNumber(ctx, orgUser.OrgID)
			if err != nil {
				return err
			}

			// Create opening
			params := regionaldb.CreateOpeningParams{
				OrgID:                  orgUser.OrgID,
				OpeningNumber:          allocated,
				Title:                  req.Title,
				Description:            req.Description,
				IsInternal:             req.IsInternal,
				EmploymentType:         regionaldb.EmploymentType(req.EmploymentType),
				WorkLocationType:       regionaldb.WorkLocationType(req.WorkLocationType),
				NumberOfPositions:      req.NumberOfPositions,
				HiringManagerOrgUserID: parseUUID(req.HiringManagerOrgUserID),
				RecruiterOrgUserID:     parseUUID(req.RecruiterOrgUserID),
			}

			if req.MinYOE != nil {
				params.MinYoe = pgtype.Int4{Int32: *req.MinYOE, Valid: true}
			}
			if req.MaxYOE != nil {
				params.MaxYoe = pgtype.Int4{Int32: *req.MaxYOE, Valid: true}
			}
			if req.MinEducationLevel != nil {
				params.MinEducationLevel = regionaldb.NullEducationLevel{
					EducationLevel: regionaldb.EducationLevel(*req.MinEducationLevel),
					Valid:          true,
				}
			}
			if req.Salary != nil {
				params.SalaryMinAmount = floatToNumeric(req.Salary.MinAmount)
				params.SalaryMaxAmount = floatToNumeric(req.Salary.MaxAmount)
				params.SalaryCurrency = pgtype.Text{String: req.Salary.Currency, Valid: true}
			}
			if req.CostCenterID != nil {
				params.CostCenterID = parseUUID(*req.CostCenterID)
			}
			if req.InternalNotes != nil {
				params.InternalNotes = pgtype.Text{String: *req.InternalNotes, Valid: true}
			}

			created, err := qtx.CreateOpening(ctx, params)
			if err != nil {
				return err
			}
			opening = created

			// Replace junction tables
			if len(req.AddressIDs) > 0 {
				addressIDs := make([]pgtype.UUID, len(req.AddressIDs))
				for i, id := range req.AddressIDs {
					addressIDs[i] = parseUUID(id)
				}
				if err := qtx.ReplaceOpeningAddresses(ctx, regionaldb.ReplaceOpeningAddressesParams{
					OpeningID:  created.OpeningID,
					AddressIds: addressIDs,
				}); err != nil {
					return err
				}
			}

			if len(req.HiringTeamMemberIDs) > 0 {
				teamIDs := make([]pgtype.UUID, len(req.HiringTeamMemberIDs))
				for i, id := range req.HiringTeamMemberIDs {
					teamIDs[i] = parseUUID(id)
				}
				if err := qtx.ReplaceOpeningHiringTeam(ctx, regionaldb.ReplaceOpeningHiringTeamParams{
					OpeningID:  created.OpeningID,
					OrgUserIds: teamIDs,
				}); err != nil {
					return err
				}
			}

			if len(req.WatcherIDs) > 0 {
				watcherIDs := make([]pgtype.UUID, len(req.WatcherIDs))
				for i, id := range req.WatcherIDs {
					watcherIDs[i] = parseUUID(id)
				}
				if err := qtx.ReplaceOpeningWatchers(ctx, regionaldb.ReplaceOpeningWatchersParams{
					OpeningID:  created.OpeningID,
					OrgUserIds: watcherIDs,
				}); err != nil {
					return err
				}
			}

			if len(req.TagIDs) > 0 {
				if err := qtx.ReplaceOpeningTags(ctx, regionaldb.ReplaceOpeningTagsParams{
					OpeningID: created.OpeningID,
					TagIds:    req.TagIDs,
				}); err != nil {
					return err
				}
			}

			// Audit log
			eventData, _ := json.Marshal(map[string]any{
				"opening_id":     created.OpeningID.String(),
				"opening_number": created.OpeningNumber,
				"title":          req.Title,
				"is_internal":    req.IsInternal,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.create_opening",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})

		if err != nil {
			log.Error("failed to create opening", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(org.CreateOpeningResponse{
			OpeningID:     opening.OpeningID.String(),
			OpeningNumber: opening.OpeningNumber,
		})
	}
}

// Helper functions

func parseUUID(uuidStr string) pgtype.UUID {
	var u pgtype.UUID
	u.Scan(uuidStr)
	return u
}

func floatToNumeric(f float64) pgtype.Numeric {
	var n pgtype.Numeric
	n.Scan(fmt.Sprintf("%f", f))
	return n
}

func validateOpeningReferences(ctx context.Context, s *server.RegionalServer, orgID pgtype.UUID, req *org.CreateOpeningRequest) error {
	// Validate addresses
	addressIDs := make([]pgtype.UUID, len(req.AddressIDs))
	for i, id := range req.AddressIDs {
		addressIDs[i] = parseUUID(id)
	}
	validAddrs, err := s.Regional.ValidateOrgAddressesActive(ctx, regionaldb.ValidateOrgAddressesActiveParams{
		OrgID:      orgID,
		AddressIds: addressIDs,
	})
	if err != nil || len(validAddrs) != len(req.AddressIDs) {
		return fmt.Errorf("some address IDs are invalid or inactive")
	}

	// Validate org users (hiring manager, recruiter, hiring team, watchers)
	userIDs := make(map[string]bool)
	userIDs[req.HiringManagerOrgUserID] = true
	userIDs[req.RecruiterOrgUserID] = true
	for _, id := range req.HiringTeamMemberIDs {
		userIDs[id] = true
	}
	for _, id := range req.WatcherIDs {
		userIDs[id] = true
	}

	userIDList := make([]pgtype.UUID, 0, len(userIDs))
	for idStr := range userIDs {
		userIDList = append(userIDList, parseUUID(idStr))
	}
	validUsers, err := s.Regional.ValidateOrgUsersActive(ctx, regionaldb.ValidateOrgUsersActiveParams{
		OrgID:      orgID,
		OrgUserIds: userIDList,
	})
	if err != nil || len(validUsers) != len(userIDs) {
		return fmt.Errorf("some org user IDs are invalid or inactive")
	}

	// Validate cost center if provided
	if req.CostCenterID != nil {
		_, err := s.Regional.ValidateCostCenterActive(ctx, regionaldb.ValidateCostCenterActiveParams{
			OrgID:        orgID,
			CostCenterID: parseUUID(*req.CostCenterID),
		})
		if err != nil {
			return fmt.Errorf("cost center is invalid or inactive")
		}
	}

	// Validate tags if provided
	if len(req.TagIDs) > 0 {
		tags, err := s.Global.GetTagsByIDs(ctx, req.TagIDs)
		if err != nil || len(tags) != len(req.TagIDs) {
			return fmt.Errorf("some tag IDs are invalid or inactive")
		}
	}

	return nil
}

func validateUpdateOpeningReferences(ctx context.Context, s *server.RegionalServer, orgID pgtype.UUID, req *org.UpdateOpeningRequest) error {
	// Validate addresses
	addressIDs := make([]pgtype.UUID, len(req.AddressIDs))
	for i, id := range req.AddressIDs {
		addressIDs[i] = parseUUID(id)
	}
	validAddrs, err := s.Regional.ValidateOrgAddressesActive(ctx, regionaldb.ValidateOrgAddressesActiveParams{
		OrgID:      orgID,
		AddressIds: addressIDs,
	})
	if err != nil || len(validAddrs) != len(req.AddressIDs) {
		return fmt.Errorf("some address IDs are invalid or inactive")
	}

	// Validate org users
	userIDs := make(map[string]bool)
	userIDs[req.HiringManagerOrgUserID] = true
	userIDs[req.RecruiterOrgUserID] = true
	for _, id := range req.HiringTeamMemberIDs {
		userIDs[id] = true
	}
	for _, id := range req.WatcherIDs {
		userIDs[id] = true
	}

	userIDList := make([]pgtype.UUID, 0, len(userIDs))
	for idStr := range userIDs {
		userIDList = append(userIDList, parseUUID(idStr))
	}
	validUsers, err := s.Regional.ValidateOrgUsersActive(ctx, regionaldb.ValidateOrgUsersActiveParams{
		OrgID:      orgID,
		OrgUserIds: userIDList,
	})
	if err != nil || len(validUsers) != len(userIDs) {
		return fmt.Errorf("some org user IDs are invalid or inactive")
	}

	// Validate cost center if provided
	if req.CostCenterID != nil {
		_, err := s.Regional.ValidateCostCenterActive(ctx, regionaldb.ValidateCostCenterActiveParams{
			OrgID:        orgID,
			CostCenterID: parseUUID(*req.CostCenterID),
		})
		if err != nil {
			return fmt.Errorf("cost center is invalid or inactive")
		}
	}

	// Validate tags if provided
	if len(req.TagIDs) > 0 {
		tags, err := s.Global.GetTagsByIDs(ctx, req.TagIDs)
		if err != nil || len(tags) != len(req.TagIDs) {
			return fmt.Errorf("some tag IDs are invalid or inactive")
		}
	}

	return nil
}

func validateDistinctTeam(req *org.CreateOpeningRequest) error {
	// Check that hiring manager, recruiter, and hiring team members are distinct
	if req.HiringManagerOrgUserID == req.RecruiterOrgUserID {
		return fmt.Errorf("hiring manager and recruiter must be different users")
	}

	for _, teamMemberID := range req.HiringTeamMemberIDs {
		if teamMemberID == req.HiringManagerOrgUserID {
			return fmt.Errorf("hiring team member cannot be the hiring manager")
		}
		if teamMemberID == req.RecruiterOrgUserID {
			return fmt.Errorf("hiring team member cannot be the recruiter")
		}
	}

	// Check for duplicates within hiring team
	teamSet := make(map[string]bool)
	for _, id := range req.HiringTeamMemberIDs {
		if teamSet[id] {
			return fmt.Errorf("hiring team members must be unique")
		}
		teamSet[id] = true
	}

	return nil
}

func validateDistinctUpdateTeam(req *org.UpdateOpeningRequest) error {
	if req.HiringManagerOrgUserID == req.RecruiterOrgUserID {
		return fmt.Errorf("hiring manager and recruiter must be different users")
	}

	for _, teamMemberID := range req.HiringTeamMemberIDs {
		if teamMemberID == req.HiringManagerOrgUserID {
			return fmt.Errorf("hiring team member cannot be the hiring manager")
		}
		if teamMemberID == req.RecruiterOrgUserID {
			return fmt.Errorf("hiring team member cannot be the recruiter")
		}
	}

	teamSet := make(map[string]bool)
	for _, id := range req.HiringTeamMemberIDs {
		if teamSet[id] {
			return fmt.Errorf("hiring team members must be unique")
		}
		teamSet[id] = true
	}

	return nil
}

func encodeOpeningCursor(createdAt time.Time, openingNumber int32) string {
	data := fmt.Sprintf("%s|%d", createdAt.UTC().Format(time.RFC3339Nano), openingNumber)
	return base64.URLEncoding.EncodeToString([]byte(data))
}

func decodeOpeningCursor(cursor string) (time.Time, int32, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, 0, err
	}
	parts := strings.Split(string(data), "|")
	if len(parts) != 2 {
		return time.Time{}, 0, fmt.Errorf("invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, 0, err
	}
	var openingNum int32
	fmt.Sscanf(parts[1], "%d", &openingNum)
	return t, openingNum, nil
}

func dbOpeningToResponse(ctx context.Context, s *server.RegionalServer, opening regionaldb.Opening) org.Opening {
	resp := org.Opening{
		OpeningID:         opening.OpeningID.String(),
		OpeningNumber:     opening.OpeningNumber,
		Title:             opening.Title,
		Description:       opening.Description,
		IsInternal:        opening.IsInternal,
		Status:            org.OpeningStatus(opening.Status),
		EmploymentType:    org.EmploymentType(opening.EmploymentType),
		WorkLocationType:  org.WorkLocationType(opening.WorkLocationType),
		NumberOfPositions: opening.NumberOfPositions,
		FilledPositions:   opening.FilledPositions,
		Addresses:         make([]org.OrgAddress, 0),
		HiringTeamMembers: make([]map[string]string, 0),
		Watchers:          make([]map[string]string, 0),
		Tags:              make([]map[string]string, 0),
		CreatedAt:         opening.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:         opening.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}

	// Add optional fields
	if opening.MinYoe.Valid {
		resp.MinYOE = &opening.MinYoe.Int32
	}
	if opening.MaxYoe.Valid {
		resp.MaxYOE = &opening.MaxYoe.Int32
	}
	if opening.MinEducationLevel.Valid {
		level := org.EducationLevel(opening.MinEducationLevel.EducationLevel)
		resp.MinEducationLevel = &level
	}
	if opening.SalaryMinAmount.Valid && opening.SalaryMaxAmount.Valid && opening.SalaryCurrency.Valid {
		minStr := opening.SalaryMinAmount.Int.String()
		maxStr := opening.SalaryMaxAmount.Int.String()
		// Convert to float64 for the response
		var minF, maxF float64
		fmt.Sscanf(minStr, "%f", &minF)
		fmt.Sscanf(maxStr, "%f", &maxF)
		resp.Salary = &org.Salary{
			MinAmount: minF,
			MaxAmount: maxF,
			Currency:  opening.SalaryCurrency.String,
		}
	}
	if opening.InternalNotes.Valid {
		resp.InternalNotes = &opening.InternalNotes.String
	}
	if opening.RejectionNote.Valid {
		resp.RejectionNote = &opening.RejectionNote.String
	}
	if opening.FirstPublishedAt.Valid {
		t := opening.FirstPublishedAt.Time.UTC().Format(time.RFC3339)
		resp.FirstPublishedAt = &t
	}

	// Fetch and populate denormalized data
	addresses, _ := s.Regional.GetOpeningAddresses(ctx, opening.OpeningID)
	hiringTeam, _ := s.Regional.GetOpeningHiringTeam(ctx, opening.OpeningID)
	watchers, _ := s.Regional.GetOpeningWatchers(ctx, opening.OpeningID)
	tags, _ := s.Regional.GetOpeningTags(ctx, opening.OpeningID)

	// Bulk-fetch users
	userIDs := make(map[pgtype.UUID]bool)
	userIDs[opening.HiringManagerOrgUserID] = true
	userIDs[opening.RecruiterOrgUserID] = true
	for _, ht := range hiringTeam {
		userIDs[ht] = true
	}
	for _, w := range watchers {
		userIDs[w] = true
	}

	usersByID := make(map[pgtype.UUID]map[string]string)
	if len(userIDs) > 0 {
		uuidList := make([]pgtype.UUID, 0, len(userIDs))
		for uid := range userIDs {
			uuidList = append(uuidList, uid)
		}
		users, _ := s.Regional.GetOrgUsersByIDs(ctx, uuidList)
		for _, u := range users {
			var fullName string
			if u.FullName.Valid {
				fullName = u.FullName.String
			}
			usersByID[u.OrgUserID] = map[string]string{
				"org_user_id": u.OrgUserID.String(),
				"full_name":   fullName,
				"email":       u.EmailAddress,
			}
		}
	}

	resp.HiringManager = usersByID[opening.HiringManagerOrgUserID]
	resp.Recruiter = usersByID[opening.RecruiterOrgUserID]

	// Add addresses
	addressMap := make(map[pgtype.UUID]regionaldb.OrgAddress)
	if len(addresses) > 0 {
		addressIDs := make([]pgtype.UUID, len(addresses))
		for i, addr := range addresses {
			addressIDs[i] = addr.AddressID
		}
		fetchedAddrs, _ := s.Regional.GetOrgAddressesByIDs(ctx, addressIDs)
		for _, a := range fetchedAddrs {
			addressMap[a.AddressID] = a
		}
	}
	for _, addr := range addresses {
		if dbAddr, ok := addressMap[addr.AddressID]; ok {
			apiAddr := org.OrgAddress{
				AddressID:    dbAddr.AddressID.String(),
				Title:        dbAddr.Title,
				AddressLine1: dbAddr.AddressLine1,
				City:         dbAddr.City,
				Country:      dbAddr.Country,
				Status:       org.OrgAddressStatus(dbAddr.Status),
				CreatedAt:    dbAddr.CreatedAt.Time.UTC().Format(time.RFC3339),
			}
			if dbAddr.AddressLine2.Valid {
				apiAddr.AddressLine2 = &dbAddr.AddressLine2.String
			}
			if dbAddr.State.Valid {
				apiAddr.State = &dbAddr.State.String
			}
			if dbAddr.PostalCode.Valid {
				apiAddr.PostalCode = &dbAddr.PostalCode.String
			}
			if dbAddr.MapUrls == nil {
				apiAddr.MapUrls = []string{}
			} else {
				apiAddr.MapUrls = dbAddr.MapUrls
			}
			resp.Addresses = append(resp.Addresses, apiAddr)
		}
	}

	// Add hiring team
	for _, ht := range hiringTeam {
		if user, ok := usersByID[ht]; ok {
			resp.HiringTeamMembers = append(resp.HiringTeamMembers, user)
		}
	}

	// Add watchers
	for _, w := range watchers {
		if user, ok := usersByID[w]; ok {
			resp.Watchers = append(resp.Watchers, user)
		}
	}

	// Add tags
	if len(tags) > 0 {
		fetchedTags, _ := s.Global.GetTagsByIDs(ctx, tags)
		for _, t := range fetchedTags {
			resp.Tags = append(resp.Tags, map[string]string{
				"tag_id": t.TagID,
			})
		}
	}

	// Add cost center
	if opening.CostCenterID.Valid {
		cc, _ := s.Regional.GetCostCenterByID(ctx, opening.CostCenterID)
		if cc.CostCenterID.Valid {
			resp.CostCenter = map[string]interface{}{
				"cost_center_id": cc.CostCenterID.String(),
				"display_name":   cc.DisplayName,
				"status":         org.CostCenterStatus(cc.Status),
			}
		}
	}

	return resp
}

// ListOpenings handles POST /org/list-openings
func ListOpenings(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.ListOpeningsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Decode cursor
		var createdAt pgtype.Timestamptz
		var openingNumber int32
		if req.PaginationKey != nil {
			var t time.Time
			var num int32
			var err error
			t, num, err = decodeOpeningCursor(*req.PaginationKey)
			if err != nil {
				log.Debug("invalid cursor", "error", err)
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
			createdAt = pgtype.Timestamptz{Time: t, Valid: true}
			openingNumber = num
		}

		// Default and cap limit
		limit := int32(defaultOpeningLimit)
		if req.Limit != nil {
			limit = *req.Limit
			if limit > maxOpeningLimit {
				limit = maxOpeningLimit
			}
		}

		// Build filter parameters
		params := regionaldb.ListOpeningsParams{
			OrgID:      orgUser.OrgID,
			LimitCount: limit + 1,
		}

		if createdAt.Valid {
			params.CursorCreatedAt = createdAt
			params.CursorOpeningNumber = pgtype.Timestamptz{Time: time.Unix(0, int64(openingNumber)), Valid: true}
		}

		// Status filters
		if len(req.FilterStatus) > 0 {
			params.FilterStatuses = make([]regionaldb.OpeningStatus, len(req.FilterStatus))
			for i, status := range req.FilterStatus {
				params.FilterStatuses[i] = regionaldb.OpeningStatus(status)
			}
		}

		// Boolean filter
		if req.FilterIsInternal != nil {
			params.FilterIsInternal = pgtype.Bool{Bool: *req.FilterIsInternal, Valid: true}
		}

		// User filters
		if req.FilterHiringManagerOrgUserID != nil {
			params.FilterHm = parseUUID(*req.FilterHiringManagerOrgUserID)
		}
		if req.FilterRecruiterOrgUserID != nil {
			params.FilterRec = parseUUID(*req.FilterRecruiterOrgUserID)
		}

		// Title prefix
		if req.FilterTitlePrefix != nil {
			params.FilterTitlePrefix = pgtype.Text{String: *req.FilterTitlePrefix, Valid: true}
		}

		// Tags
		if len(req.FilterTagIDs) > 0 {
			params.FilterTags = req.FilterTagIDs
		}

		// Run list query
		rows, err := s.Regional.ListOpenings(ctx, params)
		if err != nil {
			log.Error("failed to list openings", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Determine if there are more results
		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		// Bulk-fetch users for summaries
		userIDs := make(map[pgtype.UUID]bool)
		for _, row := range rows {
			userIDs[row.HiringManagerOrgUserID] = true
			userIDs[row.RecruiterOrgUserID] = true
		}

		usersByID := make(map[pgtype.UUID]map[string]string)
		if len(userIDs) > 0 {
			uuidList := make([]pgtype.UUID, 0, len(userIDs))
			for uid := range userIDs {
				uuidList = append(uuidList, uid)
			}
			users, _ := s.Regional.GetOrgUsersByIDs(ctx, uuidList)
			for _, u := range users {
				var fullName string
				if u.FullName.Valid {
					fullName = u.FullName.String
				}
				usersByID[u.OrgUserID] = map[string]string{
					"org_user_id": u.OrgUserID.String(),
					"full_name":   fullName,
					"email":       u.EmailAddress,
				}
			}
		}

		summaries := make([]org.OpeningSummary, len(rows))
		for i, row := range rows {
			summaries[i] = org.OpeningSummary{
				OpeningID:         row.OpeningID.String(),
				OpeningNumber:     row.OpeningNumber,
				Title:             row.Title,
				IsInternal:        row.IsInternal,
				Status:            org.OpeningStatus(row.Status),
				EmploymentType:    org.EmploymentType(row.EmploymentType),
				WorkLocationType:  org.WorkLocationType(row.WorkLocationType),
				NumberOfPositions: row.NumberOfPositions,
				FilledPositions:   row.FilledPositions,
				HiringManager:     usersByID[row.HiringManagerOrgUserID],
				Recruiter:         usersByID[row.RecruiterOrgUserID],
				CreatedAt:         row.CreatedAt.Time.UTC().Format(time.RFC3339),
			}
			if row.FirstPublishedAt.Valid {
				t := row.FirstPublishedAt.Time.UTC().Format(time.RFC3339)
				summaries[i].FirstPublishedAt = &t
			}
		}

		resp := org.ListOpeningsResponse{
			Openings: summaries,
		}
		if hasMore && len(rows) > 0 {
			resp.NextPaginationKey = &[]string{encodeOpeningCursor(rows[len(rows)-1].CreatedAt.Time, rows[len(rows)-1].OpeningNumber)}[0]
		}

		json.NewEncoder(w).Encode(resp)
	}
}

// GetOpening handles POST /org/get-opening
func GetOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OpeningNumberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		opening, err := s.Regional.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
			OrgID:         orgUser.OrgID,
			OpeningNumber: req.OpeningNumber,
		})
		if err != nil {
			log.Debug("opening not found", "error", err)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		resp := dbOpeningToResponse(ctx, s, opening)
		json.NewEncoder(w).Encode(resp)
	}
}

// UpdateOpening handles POST /org/update-opening
func UpdateOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.UpdateOpeningRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		if err := validateUpdateOpeningReferences(ctx, s, orgUser.OrgID, &req); err != nil {
			log.Debug("validation failed", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode([]map[string]string{{
				"field":   "references",
				"message": err.Error(),
			}})
			return
		}

		if err := validateDistinctUpdateTeam(&req); err != nil {
			log.Debug("validation failed", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode([]map[string]string{{
				"field":   "hiring_team",
				"message": err.Error(),
			}})
			return
		}

		var opening regionaldb.Opening
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Update opening fields
			params := regionaldb.ReplaceOpeningEditableFieldsParams{
				OrgID:                  orgUser.OrgID,
				OpeningNumber:          req.OpeningNumber,
				Title:                  req.Title,
				Description:            req.Description,
				EmploymentType:         regionaldb.EmploymentType(req.EmploymentType),
				WorkLocationType:       regionaldb.WorkLocationType(req.WorkLocationType),
				NumberOfPositions:      req.NumberOfPositions,
				HiringManagerOrgUserID: parseUUID(req.HiringManagerOrgUserID),
				RecruiterOrgUserID:     parseUUID(req.RecruiterOrgUserID),
			}

			if req.MinYOE != nil {
				params.MinYoe = pgtype.Int4{Int32: *req.MinYOE, Valid: true}
			}
			if req.MaxYOE != nil {
				params.MaxYoe = pgtype.Int4{Int32: *req.MaxYOE, Valid: true}
			}
			if req.MinEducationLevel != nil {
				params.MinEducationLevel = regionaldb.NullEducationLevel{
					EducationLevel: regionaldb.EducationLevel(*req.MinEducationLevel),
					Valid:          true,
				}
			}
			if req.Salary != nil {
				params.SalaryMinAmount = floatToNumeric(req.Salary.MinAmount)
				params.SalaryMaxAmount = floatToNumeric(req.Salary.MaxAmount)
				params.SalaryCurrency = pgtype.Text{String: req.Salary.Currency, Valid: true}
			}
			if req.CostCenterID != nil {
				params.CostCenterID = parseUUID(*req.CostCenterID)
			}
			if req.InternalNotes != nil {
				params.InternalNotes = pgtype.Text{String: *req.InternalNotes, Valid: true}
			}

			updated, err := qtx.ReplaceOpeningEditableFields(ctx, params)
			if err != nil {
				return err
			}
			opening = updated

			// Replace junction tables
			if len(req.AddressIDs) > 0 {
				addressIDs := make([]pgtype.UUID, len(req.AddressIDs))
				for i, id := range req.AddressIDs {
					addressIDs[i] = parseUUID(id)
				}
				if err := qtx.ReplaceOpeningAddresses(ctx, regionaldb.ReplaceOpeningAddressesParams{
					OpeningID:  opening.OpeningID,
					AddressIds: addressIDs,
				}); err != nil {
					return err
				}
			}

			if len(req.HiringTeamMemberIDs) > 0 {
				teamIDs := make([]pgtype.UUID, len(req.HiringTeamMemberIDs))
				for i, id := range req.HiringTeamMemberIDs {
					teamIDs[i] = parseUUID(id)
				}
				if err := qtx.ReplaceOpeningHiringTeam(ctx, regionaldb.ReplaceOpeningHiringTeamParams{
					OpeningID:  opening.OpeningID,
					OrgUserIds: teamIDs,
				}); err != nil {
					return err
				}
			}

			if len(req.WatcherIDs) > 0 {
				watcherIDs := make([]pgtype.UUID, len(req.WatcherIDs))
				for i, id := range req.WatcherIDs {
					watcherIDs[i] = parseUUID(id)
				}
				if err := qtx.ReplaceOpeningWatchers(ctx, regionaldb.ReplaceOpeningWatchersParams{
					OpeningID:  opening.OpeningID,
					OrgUserIds: watcherIDs,
				}); err != nil {
					return err
				}
			}

			if len(req.TagIDs) > 0 {
				if err := qtx.ReplaceOpeningTags(ctx, regionaldb.ReplaceOpeningTagsParams{
					OpeningID: opening.OpeningID,
					TagIds:    req.TagIDs,
				}); err != nil {
					return err
				}
			}

			// Audit log
			eventData, _ := json.Marshal(map[string]any{
				"opening_id":     opening.OpeningID.String(),
				"opening_number": opening.OpeningNumber,
				"title":          req.Title,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.update_opening",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})

		if err != nil {
			log.Error("failed to update opening", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		resp := dbOpeningToResponse(ctx, s, opening)
		json.NewEncoder(w).Encode(resp)
	}
}

// DiscardOpening handles POST /org/discard-opening
func DiscardOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OpeningNumberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// First log audit before delete
			eventData, _ := json.Marshal(map[string]any{
				"opening_number": req.OpeningNumber,
			})
			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.discard_opening",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); err != nil {
				return err
			}

			// Then discard
			return qtx.DiscardDraftOpening(ctx, regionaldb.DiscardDraftOpeningParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
		})

		if err != nil {
			// Check if it's a "not found" or "wrong state" error
			opening, _ := s.Regional.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if opening.OpeningID.Valid == false {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusUnprocessableEntity)
			}
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// DuplicateOpening handles POST /org/duplicate-opening
func DuplicateOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OpeningNumberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		sourceOpening, err := s.Regional.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
			OrgID:         orgUser.OrgID,
			OpeningNumber: req.OpeningNumber,
		})
		if err != nil {
			log.Debug("opening not found", "error", err)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		var duplicated regionaldb.Opening
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Allocate new opening number
			allocated, err := qtx.AllocateOpeningNumber(ctx, orgUser.OrgID)
			if err != nil {
				return err
			}

			// Create clone (defaults to draft status)
			params := regionaldb.CreateOpeningParams{
				OrgID:                  orgUser.OrgID,
				OpeningNumber:          allocated,
				Title:                  sourceOpening.Title,
				Description:            sourceOpening.Description,
				IsInternal:             sourceOpening.IsInternal,
				EmploymentType:         sourceOpening.EmploymentType,
				WorkLocationType:       sourceOpening.WorkLocationType,
				NumberOfPositions:      sourceOpening.NumberOfPositions,
				HiringManagerOrgUserID: sourceOpening.HiringManagerOrgUserID,
				RecruiterOrgUserID:     sourceOpening.RecruiterOrgUserID,
				MinYoe:                 sourceOpening.MinYoe,
				MaxYoe:                 sourceOpening.MaxYoe,
				MinEducationLevel:      sourceOpening.MinEducationLevel,
				SalaryMinAmount:        sourceOpening.SalaryMinAmount,
				SalaryMaxAmount:        sourceOpening.SalaryMaxAmount,
				SalaryCurrency:         sourceOpening.SalaryCurrency,
				CostCenterID:           sourceOpening.CostCenterID,
				InternalNotes:          sourceOpening.InternalNotes,
			}

			created, err := qtx.CreateOpening(ctx, params)
			if err != nil {
				return err
			}
			duplicated = created

			// Copy junctions
			addresses, _ := qtx.GetOpeningAddresses(ctx, sourceOpening.OpeningID)
			if len(addresses) > 0 {
				addressIDs := make([]pgtype.UUID, len(addresses))
				for i, addr := range addresses {
					addressIDs[i] = addr.AddressID
				}
				if err := qtx.ReplaceOpeningAddresses(ctx, regionaldb.ReplaceOpeningAddressesParams{
					OpeningID:  created.OpeningID,
					AddressIds: addressIDs,
				}); err != nil {
					return err
				}
			}

			hiringTeam, _ := qtx.GetOpeningHiringTeam(ctx, sourceOpening.OpeningID)
			if len(hiringTeam) > 0 {
				if err := qtx.ReplaceOpeningHiringTeam(ctx, regionaldb.ReplaceOpeningHiringTeamParams{
					OpeningID:  created.OpeningID,
					OrgUserIds: hiringTeam,
				}); err != nil {
					return err
				}
			}

			watchers, _ := qtx.GetOpeningWatchers(ctx, sourceOpening.OpeningID)
			if len(watchers) > 0 {
				if err := qtx.ReplaceOpeningWatchers(ctx, regionaldb.ReplaceOpeningWatchersParams{
					OpeningID:  created.OpeningID,
					OrgUserIds: watchers,
				}); err != nil {
					return err
				}
			}

			tags, _ := qtx.GetOpeningTags(ctx, sourceOpening.OpeningID)
			if len(tags) > 0 {
				if err := qtx.ReplaceOpeningTags(ctx, regionaldb.ReplaceOpeningTagsParams{
					OpeningID: created.OpeningID,
					TagIds:    tags,
				}); err != nil {
					return err
				}
			}

			// Audit log
			eventData, _ := json.Marshal(map[string]any{
				"opening_id":         created.OpeningID.String(),
				"opening_number":     created.OpeningNumber,
				"source_opening_id":  sourceOpening.OpeningID.String(),
				"source_opening_num": sourceOpening.OpeningNumber,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.duplicate_opening",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})

		if err != nil {
			log.Error("failed to duplicate opening", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(org.CreateOpeningResponse{
			OpeningID:     duplicated.OpeningID.String(),
			OpeningNumber: duplicated.OpeningNumber,
		})
	}
}

// SubmitOpening handles POST /org/submit-opening
func SubmitOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OpeningNumberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Check if user is superadmin
		isSuperadmin := false
		superadminRole, err := s.Regional.GetRoleByName(ctx, "org:superadmin")
		if err == nil {
			hasRole, err := s.Regional.HasOrgUserRole(ctx, regionaldb.HasOrgUserRoleParams{
				OrgUserID: orgUser.OrgUserID,
				RoleID:    superadminRole.RoleID,
			})
			if err == nil && hasRole {
				isSuperadmin = true
			}
		}

		targetStatus := regionaldb.OpeningStatusPendingReview
		if isSuperadmin {
			targetStatus = regionaldb.OpeningStatusPublished
		}

		var opening regionaldb.Opening
		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			updated, err := qtx.TransitionOpeningSubmit(ctx, regionaldb.TransitionOpeningSubmitParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
				TargetStatus:  targetStatus,
			})
			if err != nil {
				return err
			}
			opening = updated

			// Audit log
			auditEvent := "org.submit_opening"
			if isSuperadmin {
				auditEvent = "org.publish_opening"
			}
			eventData, _ := json.Marshal(map[string]any{
				"opening_id":     updated.OpeningID.String(),
				"opening_number": updated.OpeningNumber,
				"status":         updated.Status,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   auditEvent,
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})

		if txErr != nil {
			// Check if it's a "not found" or "wrong state" error
			existing, _ := s.Regional.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if existing.OpeningID.Valid == false {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusUnprocessableEntity)
			}
			return
		}

		resp := dbOpeningToResponse(ctx, s, opening)
		json.NewEncoder(w).Encode(resp)
	}
}

// ApproveOpening handles POST /org/approve-opening
func ApproveOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OpeningNumberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var opening regionaldb.Opening
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			updated, err := qtx.TransitionOpeningApprove(ctx, regionaldb.TransitionOpeningApproveParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if err != nil {
				return err
			}
			opening = updated

			eventData, _ := json.Marshal(map[string]any{
				"opening_id":     updated.OpeningID.String(),
				"opening_number": updated.OpeningNumber,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.publish_opening",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})

		if err != nil {
			existing, _ := s.Regional.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if existing.OpeningID.Valid == false {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusUnprocessableEntity)
			}
			return
		}

		resp := dbOpeningToResponse(ctx, s, opening)
		json.NewEncoder(w).Encode(resp)
	}
}

// RejectOpening handles POST /org/reject-opening
func RejectOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.RejectOpeningRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var opening regionaldb.Opening
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			updated, err := qtx.TransitionOpeningReject(ctx, regionaldb.TransitionOpeningRejectParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
				RejectionNote: pgtype.Text{String: req.RejectionNote, Valid: true},
			})
			if err != nil {
				return err
			}
			opening = updated

			eventData, _ := json.Marshal(map[string]any{
				"opening_id":     updated.OpeningID.String(),
				"opening_number": updated.OpeningNumber,
				"rejection_note": req.RejectionNote,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.reject_opening",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})

		if err != nil {
			existing, _ := s.Regional.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if existing.OpeningID.Valid == false {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusUnprocessableEntity)
			}
			return
		}

		resp := dbOpeningToResponse(ctx, s, opening)
		json.NewEncoder(w).Encode(resp)
	}
}

// PauseOpening handles POST /org/pause-opening
func PauseOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OpeningNumberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var opening regionaldb.Opening
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			updated, err := qtx.TransitionOpeningPause(ctx, regionaldb.TransitionOpeningPauseParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if err != nil {
				return err
			}
			opening = updated

			eventData, _ := json.Marshal(map[string]any{
				"opening_id":     updated.OpeningID.String(),
				"opening_number": updated.OpeningNumber,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.pause_opening",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})

		if err != nil {
			existing, _ := s.Regional.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if existing.OpeningID.Valid == false {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusUnprocessableEntity)
			}
			return
		}

		resp := dbOpeningToResponse(ctx, s, opening)
		json.NewEncoder(w).Encode(resp)
	}
}

// ReopenOpening handles POST /org/reopen-opening
func ReopenOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OpeningNumberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var opening regionaldb.Opening
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			updated, err := qtx.TransitionOpeningReopen(ctx, regionaldb.TransitionOpeningReopenParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if err != nil {
				return err
			}
			opening = updated

			eventData, _ := json.Marshal(map[string]any{
				"opening_id":     updated.OpeningID.String(),
				"opening_number": updated.OpeningNumber,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.reopen_opening",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})

		if err != nil {
			existing, _ := s.Regional.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if existing.OpeningID.Valid == false {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusUnprocessableEntity)
			}
			return
		}

		resp := dbOpeningToResponse(ctx, s, opening)
		json.NewEncoder(w).Encode(resp)
	}
}

// CloseOpening handles POST /org/close-opening
func CloseOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OpeningNumberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var opening regionaldb.Opening
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			updated, err := qtx.TransitionOpeningClose(ctx, regionaldb.TransitionOpeningCloseParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if err != nil {
				return err
			}
			opening = updated

			eventData, _ := json.Marshal(map[string]any{
				"opening_id":     updated.OpeningID.String(),
				"opening_number": updated.OpeningNumber,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.close_opening",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})

		if err != nil {
			existing, _ := s.Regional.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if existing.OpeningID.Valid == false {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusUnprocessableEntity)
			}
			return
		}

		resp := dbOpeningToResponse(ctx, s, opening)
		json.NewEncoder(w).Encode(resp)
	}
}

// ArchiveOpening handles POST /org/archive-opening
func ArchiveOpening(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.OpeningNumberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var opening regionaldb.Opening
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			updated, err := qtx.TransitionOpeningArchive(ctx, regionaldb.TransitionOpeningArchiveParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if err != nil {
				return err
			}
			opening = updated

			eventData, _ := json.Marshal(map[string]any{
				"opening_id":     updated.OpeningID.String(),
				"opening_number": updated.OpeningNumber,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.archive_opening",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})

		if err != nil {
			existing, _ := s.Regional.GetOpeningByNumber(ctx, regionaldb.GetOpeningByNumberParams{
				OrgID:         orgUser.OrgID,
				OpeningNumber: req.OpeningNumber,
			})
			if existing.OpeningID.Valid == false {
				w.WriteHeader(http.StatusNotFound)
			} else {
				w.WriteHeader(http.StatusUnprocessableEntity)
			}
			return
		}

		resp := dbOpeningToResponse(ctx, s, opening)
		json.NewEncoder(w).Encode(resp)
	}
}
