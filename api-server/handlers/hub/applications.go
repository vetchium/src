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
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	hub "vetchium-api-server.typespec/hub"
)

func parseAppCursor(key string) (pgtype.Timestamptz, pgtype.UUID) {
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

func ListMyApplications(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.ListMyApplicationsRequest
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

		// One global round-trip: get applications_index entries (keyset paginated)
		var indexRows []globaldb.ApplicationsIndex
		var err error
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursorTs, cursorID := parseAppCursor(*req.PaginationKey)
			indexRows, err = s.Global.GetApplicationIndexEntriesByUserAfter(ctx,
				globaldb.GetApplicationIndexEntriesByUserAfterParams{
					HubUserGlobalID:     hubUser.HubUserGlobalID,
					CursorAppliedAt:     cursorTs,
					CursorApplicationID: cursorID,
					Limit:               limit + 1,
				})
		} else {
			indexRows, err = s.Global.GetApplicationIndexEntriesByUser(ctx,
				globaldb.GetApplicationIndexEntriesByUserParams{
					HubUserGlobalID: hubUser.HubUserGlobalID,
					Limit:           limit + 1,
				})
		}
		if err != nil {
			s.Logger(ctx).Error("failed to get application index", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(indexRows)) > limit {
			indexRows = indexRows[:limit]
			last := indexRows[len(indexRows)-1]
			k := fmt.Sprintf("%s|%s",
				last.AppliedAt.Time.UTC().Format(time.RFC3339Nano),
				last.ApplicationID.String())
			nextKey = &k
		}

		// Build summaries from index (no regional lookup needed; index has state + org_domain + opening_number)
		summaries := make([]hub.HubApplicationSummary, 0, len(indexRows))
		for _, idx := range indexRows {
			summaries = append(summaries, hub.HubApplicationSummary{
				ApplicationID:  idx.ApplicationID.String(),
				OrgDomain:      idx.OrgDomain,
				OrgName:        "",
				OpeningNumber:  idx.OpeningNumber,
				OpeningTitle:   "",
				State:          hub.ApplicationState(idx.State),
				AppliedAt:      idx.AppliedAt.Time.UTC().Format(time.RFC3339),
				StateChangedAt: idx.AppliedAt.Time.UTC().Format(time.RFC3339),
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(hub.ListMyApplicationsResponse{
			Applications:      summaries,
			NextPaginationKey: nextKey,
		})
	}
}

func GetMyApplication(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.GetMyApplicationRequest
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

		var appID pgtype.UUID
		if err := appID.Scan(req.ApplicationID); err != nil {
			http.Error(w, "invalid application_id format", http.StatusBadRequest)
			return
		}

		// One global round-trip: resolve region + org name + primary domain
		indexEntry, err := s.Global.GetApplicationIndexEntryWithOrg(ctx, appID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to resolve application region", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		regionalDB := s.GetRegionalDB(globaldb.Region(indexEntry.Region))
		if regionalDB == nil {
			s.Logger(ctx).Error("unknown application region", "region", indexEntry.Region)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// One regional round-trip: get application + opening title verifying ownership
		app, err := regionalDB.GetApplicationByApplicantWithOpening(ctx,
			regionaldb.GetApplicationByApplicantWithOpeningParams{
				ApplicationID:            appID,
				ApplicantHubUserGlobalID: hubUser.HubUserGlobalID,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var label *hub.ApplicationColorLabel
		if app.Label.Valid {
			l := hub.ApplicationColorLabel(app.Label.String)
			label = &l
		}

		result := hub.HubApplication{
			ApplicationID:            app.ApplicationID.String(),
			OrgDomain:                indexEntry.PrimaryDomain,
			OrgName:                  indexEntry.OrgName,
			OpeningNumber:            app.OpeningNumber,
			OpeningTitle:             app.OpeningTitle,
			State:                    hub.ApplicationState(app.State),
			Label:                    label,
			AppliedAt:                app.AppliedAt.Time.UTC().Format(time.RFC3339),
			StateChangedAt:           app.StateChangedAt.Time.UTC().Format(time.RFC3339),
			CoverLetter:              app.CoverLetter,
			ResumeDownloadURL:        "",
			Endorsements:             []hub.MyEndorsementOnApplication{},
			EndorsementRequests:      []hub.MyEndorsementRequestSent{},
			NotifyColleaguesAtTarget: app.NotifyColleaguesAtTarget,
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(result)
	}
}

func WithdrawApplication(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hub.WithdrawApplicationRequest
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

		var appID pgtype.UUID
		if err := appID.Scan(req.ApplicationID); err != nil {
			http.Error(w, "invalid application_id format", http.StatusBadRequest)
			return
		}

		// Resolve the application's region (one global hop) and write there.
		region, err := regionForApplication(ctx, s, appID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to resolve application region", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		eventData, _ := json.Marshal(map[string]any{"application_id": req.ApplicationID})
		if err := s.WithRegionalTxFor(ctx, region, func(qtx *regionaldb.Queries) error {
			app, txErr := qtx.GetApplicationByApplicant(ctx,
				regionaldb.GetApplicationByApplicantParams{
					ApplicationID:            appID,
					ApplicantHubUserGlobalID: hubUser.HubUserGlobalID,
				})
			if txErr != nil {
				return txErr
			}
			if app.State != "applied" {
				return server.ErrInvalidState
			}

			if txErr := qtx.WithdrawApplication(ctx, appID); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.withdraw_application",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to withdraw application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Update global index state
		if err := s.Global.UpdateApplicationIndexState(ctx, globaldb.UpdateApplicationIndexStateParams{
			ApplicationID: appID,
			State:         "withdrawn",
		}); err != nil {
			s.Logger(ctx).Error("failed to update application index", "error", err)
			// Non-fatal: regional write succeeded; log for reconciliation
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(struct{}{})
	}
}
