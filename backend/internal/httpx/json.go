// Package httpx contains the JSON request and response conventions shared by
// the portal APIs.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/vetchium/src/typespec/problem"
)

// MaxRequestBody bounds the small JSON documents accepted by portal APIs.
const MaxRequestBody = 64 << 10

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

// WriteProblem writes an RFC 9457 problem-details response.
func WriteProblem(w http.ResponseWriter, details problem.Details) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(details.Status)
	_ = json.NewEncoder(w).Encode(details)
}

// WriteBearerProblem writes a 401 problem and the challenge required by HTTP
// authentication semantics.
func WriteBearerProblem(w http.ResponseWriter, realm string, details problem.Details) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="`+realm+`"`)
	WriteProblem(w, details)
}
