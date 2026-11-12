package openings

import (
	"net/http"

	"github.com/vetchium/src/typespec/common"

	"backend/internal/apiserver"
	hubruntime "backend/internal/hub"
	"backend/internal/openingtags"
)

func ListTags(s *hubruntime.Server) http.HandlerFunc {
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
