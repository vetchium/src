package agency

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/agency"
)

const tagIconURLBase = "/public/tag-icon"

const tagFilterDefaultLimit = 25

func buildTagResponse(row globaldb.FilterTagsForLocaleRow) agency.Tag {
	t := agency.Tag{
		TagID:       row.TagID,
		DisplayName: row.DisplayName,
	}
	if row.Description.Valid {
		desc := row.Description.String
		t.Description = &desc
	}
	if row.SmallIconKey.Valid {
		url := fmt.Sprintf("%s?tag_id=%s&size=small", tagIconURLBase, row.TagID)
		t.SmallIconURL = &url
	}
	if row.LargeIconKey.Valid {
		url := fmt.Sprintf("%s?tag_id=%s&size=large", tagIconURLBase, row.TagID)
		t.LargeIconURL = &url
	}
	return t
}

func buildTagFromLocaleRow(row globaldb.GetTagWithLocaleRow) agency.Tag {
	t := agency.Tag{
		TagID:       row.TagID,
		DisplayName: row.DisplayName,
	}
	if row.Description.Valid {
		desc := row.Description.String
		t.Description = &desc
	}
	if row.SmallIconKey.Valid {
		url := fmt.Sprintf("%s?tag_id=%s&size=small", tagIconURLBase, row.TagID)
		t.SmallIconURL = &url
	}
	if row.LargeIconKey.Valid {
		url := fmt.Sprintf("%s?tag_id=%s&size=large", tagIconURLBase, row.TagID)
		t.LargeIconURL = &url
	}
	return t
}

// GetTag handles POST /agency/get-tag
func GetTag(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			log.Debug("agency user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req agency.GetTagRequest
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

		locale := req.Locale
		if locale == "" {
			locale = "en-US"
		}

		row, err := s.Global.GetTagWithLocale(ctx, globaldb.GetTagWithLocaleParams{
			TagID:  req.TagID,
			Locale: locale,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("tag not found", "tag_id", req.TagID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get tag", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildTagFromLocaleRow(row))
	}
}

// FilterTags handles POST /agency/filter-tags
func FilterTags(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			log.Debug("agency user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req agency.FilterTagsRequest
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

		locale := req.Locale
		if locale == "" {
			locale = "en-US"
		}

		rows, err := s.Global.FilterTagsForLocale(ctx, globaldb.FilterTagsForLocaleParams{
			Locale:        locale,
			Query:         req.Query,
			PaginationKey: req.PaginationKey,
			LimitCount:    tagFilterDefaultLimit + 1,
		})
		if err != nil {
			log.Error("failed to filter tags", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > tagFilterDefaultLimit
		if hasMore {
			rows = rows[:tagFilterDefaultLimit]
		}

		var nextPaginationKey string
		if hasMore {
			nextPaginationKey = rows[len(rows)-1].TagID
		}

		tags := make([]agency.Tag, 0, len(rows))
		for _, row := range rows {
			tags = append(tags, buildTagResponse(row))
		}

		json.NewEncoder(w).Encode(agency.FilterTagsResponse{
			Tags:          tags,
			PaginationKey: nextPaginationKey,
		})
	}
}
