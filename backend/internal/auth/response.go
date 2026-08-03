package auth

import "net/http"

const bearerRealm = "login"

// Unauthorized writes a bodyless 401 response with the Bearer challenge
// required by RFC 9110 for a 401 response.
func Unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="`+bearerRealm+`"`)
	w.WriteHeader(http.StatusUnauthorized)
}
