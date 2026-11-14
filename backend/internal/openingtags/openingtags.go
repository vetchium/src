// Package openingtags reads the Opening tag catalog that orgs-api and hub-api
// both serve.
package openingtags

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/vetchium/src/typespec/common"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

// Handler serves list-opening-tags; each API wraps it in its own
// authentication (OPN-TAG-006).
func Handler(s apiserver.RuntimeServer, queries sqlc.Querier) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request common.ListOpeningTagsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		runtime := s.HandlerRuntime()
		response, err := List(r.Context(), queries)
		if err != nil {
			runtime.InternalError(r.Context(), w, "list Opening tags", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		runtime.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func List(
	ctx context.Context, queries sqlc.Querier,
) (common.ListOpeningTagsResponse, error) {
	rows, err := queries.ListOpeningTags(ctx)
	if err != nil {
		return common.ListOpeningTagsResponse{}, fmt.Errorf(
			"list Opening tags: %w", err,
		)
	}
	return fromRows(rows)
}

func fromRows(
	rows []sqlc.ListOpeningTagsRow,
) (common.ListOpeningTagsResponse, error) {
	tags := make([]common.OpeningTag, 0, len(rows))
	for _, row := range rows {
		names := map[string]string{}
		if err := json.Unmarshal(row.LocalizedNames, &names); err != nil {
			return common.ListOpeningTagsResponse{}, fmt.Errorf(
				"decode localized names of Opening tag %s: %w", row.TagOid, err,
			)
		}
		tags = append(tags, common.OpeningTag{
			TagOID:         common.OpeningTagOID(row.TagOid),
			DisplayName:    row.DisplayName,
			LocalizedNames: names,
			Deprecated:     row.Deprecated,
		})
	}
	return common.ListOpeningTagsResponse{Tags: tags}, nil
}
