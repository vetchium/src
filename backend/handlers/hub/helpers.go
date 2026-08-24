package hub

import (
	"net/http"

	"backend/internal/apiserver"
	"backend/internal/hubapi"
)

func decodeAndValidate[T any](
	s *hubapi.Server, w http.ResponseWriter, r *http.Request,
	request *T, validate func() []string,
) bool {
	if err := apiserver.DecodeJSON(r, request); err != nil {
		s.InvalidJSON(r.Context(), w, err)
		return false
	}
	if fields := validate(); len(fields) != 0 {
		s.ValidationFailed(r.Context(), w, fields)
		return false
	}
	return true
}
