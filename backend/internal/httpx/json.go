// Package httpx contains the JSON request and response conventions shared by
// the portal APIs.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// MaxRequestBody bounds the small JSON documents accepted by portal APIs.
const MaxRequestBody = 64 << 10

// Problem is the JSON representation defined by RFC 9457. Type, title, and
// status are always emitted so clients do not need to supply RFC defaults.
type Problem struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail,omitempty"`
	Instance string `json:"instance,omitempty"`
}

// DecodeJSON decodes exactly one JSON value and rejects unknown fields.
func DecodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxRequestBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode request body: %w", err)
	}
	if err := decoder.Decode(new(json.RawMessage)); !errors.Is(err, io.EOF) {
		if err != nil {
			return fmt.Errorf("decode trailing request content: %w", err)
		}
		return errors.New("decode request body: unexpected trailing content")
	}
	return nil
}

// WriteJSON writes a successful JSON response.
func WriteJSON(w http.ResponseWriter, status int, body any) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(body)
}

// WriteProblem writes an RFC 9457 problem detail using the generic
// "about:blank" problem type. The title therefore matches the HTTP status
// phrase, while detail describes this occurrence without exposing internals.
func WriteProblem(w http.ResponseWriter, status int, detail string) {
	WriteProblemType(w, status, "about:blank", http.StatusText(status), detail)
}

// WriteProblemType writes a problem with application-specific semantics. The
// type URI and title must remain stable across occurrences of that problem.
func WriteProblemType(w http.ResponseWriter, status int, typeURI, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Problem{
		Type:   typeURI,
		Title:  title,
		Status: status,
		Detail: detail,
	})
}

// WriteBearerProblem writes a 401 problem and the challenge required by HTTP
// authentication semantics.
func WriteBearerProblem(w http.ResponseWriter, realm, typeURI, title, detail string) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="`+realm+`"`)
	WriteProblemType(w, http.StatusUnauthorized, typeURI, title, detail)
}
