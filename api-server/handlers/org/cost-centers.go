package org

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/org"
)

const (
	defaultCostCenterLimit = 20
	maxCostCenterLimit     = 100
)

// AddCostCenter handles POST /org/add-cost-center
func AddCostCenter(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.AddCostCenterRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var notes pgtype.Text
		if req.Notes != nil {
			notes = pgtype.Text{String: *req.Notes, Valid: true}
		}

		params := regionaldb.CreateCostCenterParams{
			OrgID:  orgUser.OrgID,
			ID:          req.ID,
			DisplayName: req.DisplayName,
			Notes:       notes,
		}

		var cc regionaldb.CostCenter
		eventData, _ := json.Marshal(map[string]any{"cost_center_id": req.ID})
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			cc, txErr = qtx.CreateCostCenter(ctx, params)
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.add_cost_center",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				// unique_violation: duplicate (employer_id, id)
				w.WriteHeader(http.StatusConflict)
				return
			}
			s.Logger(ctx).Error("failed to create cost center", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(dbCostCenterToResponse(cc))
	}
}

// UpdateCostCenter handles POST /org/update-cost-center
func UpdateCostCenter(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.UpdateCostCenterRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var notes pgtype.Text
		if req.Notes != nil {
			notes = pgtype.Text{String: *req.Notes, Valid: true}
		}

		params := regionaldb.UpdateCostCenterParams{
			OrgID:  orgUser.OrgID,
			ID:          req.ID,
			DisplayName: req.DisplayName,
			Status:      regionaldb.CostCenterStatus(req.Status),
			Notes:       notes,
		}

		var cc regionaldb.CostCenter
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			oldCC, txErr := qtx.GetCostCenterByOrgAndID(ctx, regionaldb.GetCostCenterByOrgAndIDParams{
				OrgID: orgUser.OrgID,
				ID:         req.ID,
			})
			if txErr != nil {
				return txErr
			}

			var fieldsChanged []string
			if oldCC.DisplayName != req.DisplayName {
				fieldsChanged = append(fieldsChanged, "display_name")
			}
			if string(oldCC.Status) != string(req.Status) {
				fieldsChanged = append(fieldsChanged, "status")
			}
			var oldNotes string
			if oldCC.Notes.Valid {
				oldNotes = oldCC.Notes.String
			}
			var newNotes string
			if req.Notes != nil {
				newNotes = *req.Notes
			}
			if oldNotes != newNotes {
				fieldsChanged = append(fieldsChanged, "notes")
			}

			cc, txErr = qtx.UpdateCostCenter(ctx, params)
			if txErr != nil {
				return txErr
			}

			updateEventData, _ := json.Marshal(map[string]any{
				"cost_center_id": req.ID,
				"fields_changed": fieldsChanged,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.update_cost_center",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   updateEventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to update cost center", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbCostCenterToResponse(cc))
	}
}

// ListCostCenters handles POST /org/list-cost-centers
func ListCostCenters(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.ListCostCentersRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := defaultCostCenterLimit
		if req.Limit != nil {
			limit = int(*req.Limit)
			if limit > maxCostCenterLimit {
				limit = maxCostCenterLimit
			}
		}

		var cursorCreatedAt pgtype.Timestamp
		var cursorID pgtype.UUID

		if req.Cursor != nil && *req.Cursor != "" {
			ca, id, err := decodeCostCenterCursor(*req.Cursor)
			if err != nil {
				s.Logger(ctx).Debug("invalid cursor", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
			cursorCreatedAt = pgtype.Timestamp{Time: ca, Valid: true}
			if err := cursorID.Scan(id); err != nil {
				s.Logger(ctx).Debug("invalid cursor id", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
		}

		var filterStatus regionaldb.NullCostCenterStatus
		if req.FilterStatus != nil {
			filterStatus = regionaldb.NullCostCenterStatus{
				CostCenterStatus: regionaldb.CostCenterStatus(*req.FilterStatus),
				Valid:            true,
			}
		}

		params := regionaldb.ListCostCentersParams{
			OrgID:      orgUser.OrgID,
			FilterStatus:    filterStatus,
			CursorCreatedAt: cursorCreatedAt,
			CursorID:        cursorID,
			LimitCount:      int32(limit + 1),
		}

		costCenters, err := s.Regional.ListCostCenters(ctx, params)
		if err != nil {
			s.Logger(ctx).Error("failed to list cost centers", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(costCenters) > limit
		if hasMore {
			costCenters = costCenters[:limit]
		}

		items := make([]org.CostCenter, 0, len(costCenters))
		for _, cc := range costCenters {
			items = append(items, dbCostCenterToResponse(cc))
		}

		var nextCursor string
		if hasMore && len(costCenters) > 0 {
			last := costCenters[len(costCenters)-1]
			if last.CreatedAt.Valid {
				nextCursor = encodeCostCenterCursor(last.CreatedAt.Time, last.CostCenterID)
			}
		}

		response := org.ListCostCentersResponse{
			Items:      items,
			NextCursor: nextCursor,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}

func dbCostCenterToResponse(cc regionaldb.CostCenter) org.CostCenter {
	resp := org.CostCenter{
		ID:          cc.ID,
		DisplayName: cc.DisplayName,
		Status:      org.CostCenterStatus(cc.Status),
		CreatedAt:   cc.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
	if cc.Notes.Valid {
		resp.Notes = &cc.Notes.String
	}
	return resp
}

func encodeCostCenterCursor(createdAt time.Time, id pgtype.UUID) string {
	idBytes := id.Bytes
	idStr := fmt.Sprintf("%x-%x-%x-%x-%x", idBytes[0:4], idBytes[4:6], idBytes[6:8], idBytes[8:10], idBytes[10:16])
	data := fmt.Sprintf("%s|%s", createdAt.UTC().Format(time.RFC3339Nano), idStr)
	return base64.URLEncoding.EncodeToString([]byte(data))
}

func decodeCostCenterCursor(cursor string) (time.Time, string, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.Split(string(data), "|")
	if len(parts) != 2 {
		return time.Time{}, "", fmt.Errorf("invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", err
	}
	return t, parts[1], nil
}
