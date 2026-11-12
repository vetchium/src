package openings

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/vetchium/src/typespec/common"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/openingtags"
	orgsruntime "backend/internal/orgs"
)

func ListTags(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request common.ListOpeningTagsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		response, err := openingtags.List(r.Context(), s.Queries)
		if err != nil {
			s.InternalError(r.Context(), w, "list Opening tags", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// unknownTags turns the statement's catalog misses into the refusal, or nil
// when every tag is in the catalog (OPN-TAG-008).
func unknownTags(encoded []byte) (*orgsproblem.OpeningTagUnknownDetails, error) {
	var oids []string
	if err := json.Unmarshal(encoded, &oids); err != nil {
		return nil, fmt.Errorf("decode unknown Opening tags: %w", err)
	}
	if len(oids) == 0 {
		return nil, nil
	}
	details := orgsproblem.OpeningTagUnknownError(oids)
	return &details, nil
}
