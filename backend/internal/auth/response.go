package auth

import "net/http"

// Unauthorized writes a bodyless 401 response with the Bearer challenge
// required by RFC 9110 for a 401 response.
func Unauthorized(w http.ResponseWriter, realm string) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="`+realm+`"`)
	w.WriteHeader(http.StatusUnauthorized)
}
