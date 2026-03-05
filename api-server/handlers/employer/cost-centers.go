package employer

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
	"vetchium-api-server.typespec/employer"
)

const (
	defaultCostCenterLimit = 20
	maxCostCenterLimit     = 100
)

// AddCostCenter handles POST /employer/add-cost-center
func AddCostCenter(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req employer.AddCostCenterRequest
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

		var notes pgtype.Text
		if req.Notes != nil {
			notes = pgtype.Text{String: *req.Notes, Valid: true}
		}

		params := regionaldb.CreateCostCenterParams{
			EmployerID:  orgUser.EmployerID,
			ID:          req.ID,
			DisplayName: req.DisplayName,
			Notes:       notes,
		}

		var cc regionaldb.CostCenter
		eventData, _ := json.Marshal(map[string]any{"id": req.ID})
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			cc, txErr = qtx.CreateCostCenter(ctx, params)
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "employer.add_cost_center",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.EmployerID,
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
			log.Error("failed to create cost center", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(dbCostCenterToResponse(cc))
	}
}

// UpdateCostCenter handles POST /employer/update-cost-center
func UpdateCostCenter(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req employer.UpdateCostCenterRequest
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

		var notes pgtype.Text
		if req.Notes != nil {
			notes = pgtype.Text{String: *req.Notes, Valid: true}
		}

		params := regionaldb.UpdateCostCenterParams{
			EmployerID:  orgUser.EmployerID,
			ID:          req.ID,
			DisplayName: req.DisplayName,
			Status:      regionaldb.CostCenterStatus(req.Status),
			Notes:       notes,
		}

		var cc regionaldb.CostCenter
		updateEventData, _ := json.Marshal(map[string]any{"id": req.ID})
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			cc, txErr = qtx.UpdateCostCenter(ctx, params)
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "employer.update_cost_center",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.EmployerID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   updateEventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to update cost center", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbCostCenterToResponse(cc))
	}
}

// ListCostCenters handles POST /employer/list-cost-centers
func ListCostCenters(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req employer.ListCostCentersRequest
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
				log.Debug("invalid cursor", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
			cursorCreatedAt = pgtype.Timestamp{Time: ca, Valid: true}
			if err := cursorID.Scan(id); err != nil {
				log.Debug("invalid cursor id", "error", err)
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
			EmployerID:      orgUser.EmployerID,
			FilterStatus:    filterStatus,
			CursorCreatedAt: cursorCreatedAt,
			CursorID:        cursorID,
			LimitCount:      int32(limit + 1),
		}

		costCenters, err := s.Regional.ListCostCenters(ctx, params)
		if err != nil {
			log.Error("failed to list cost centers", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(costCenters) > limit
		if hasMore {
			costCenters = costCenters[:limit]
		}

		items := make([]employer.CostCenter, 0, len(costCenters))
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

		response := employer.ListCostCentersResponse{
			Items:      items,
			NextCursor: nextCursor,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

func dbCostCenterToResponse(cc regionaldb.CostCenter) employer.CostCenter {
	resp := employer.CostCenter{
		ID:          cc.ID,
		DisplayName: cc.DisplayName,
		Status:      employer.CostCenterStatus(cc.Status),
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
