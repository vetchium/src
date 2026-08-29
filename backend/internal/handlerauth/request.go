// Package handlerauth provides HTTP and transaction behavior shared by portal
// authentication handlers.
package handlerauth

import (
	"net/http"

	"backend/internal/apiserver"
)

// RuntimeServer exposes the common server runtime without coupling handlers to
// one portal's server type.
type RuntimeServer interface {
	HandlerRuntime() *apiserver.Runtime
}

// DecodeAndValidate decodes one strict JSON value and reports wire validation
// failures through the common problem response path.
func DecodeAndValidate[T any](
	s RuntimeServer, w http.ResponseWriter, r *http.Request,
	request *T, validate func() []string,
) bool {
	runtime := s.HandlerRuntime()
	if err := apiserver.DecodeJSON(r, request); err != nil {
		runtime.InvalidJSON(r.Context(), w, err)
		return false
	}
	if fields := validate(); len(fields) != 0 {
		runtime.ValidationFailed(r.Context(), w, fields)
		return false
	}
	return true
}
