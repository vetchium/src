package apiserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// RuntimeServer exposes the common server runtime without coupling handlers to
// one portal's server type.
type RuntimeServer interface {
	HandlerRuntime() *Runtime
}

// Request is the contract every decoded request body satisfies. Normalize
// canonicalizes in place, which lets Decode guarantee that Validate and the
// handler after it only ever see normalized values. A request type that needs
// no canonicalization still declares an empty Normalize, so adding a field that
// does need it is a visible omission rather than a silent one.
type Request interface {
	Normalize()
	Validate() []string
}

// Decode reads one strict JSON body into request, normalizes it, and reports
// wire failures through the common problem response path. It returns false when
// the response has already been written.
func Decode(
	s RuntimeServer, w http.ResponseWriter, r *http.Request, request Request,
) bool {
	runtime := s.HandlerRuntime()
	if err := DecodeJSON(r, request); err != nil {
		runtime.InvalidJSON(r.Context(), w, err)
		return false
	}
	request.Normalize()
	if fields := request.Validate(); len(fields) != 0 {
		runtime.ValidationFailed(r.Context(), w, fields)
		return false
	}
	return true
}

func DecodeJSON(r *http.Request, destination any) error {
	mediaType := strings.TrimSpace(strings.Split(
		r.Header.Get("Content-Type"), ";",
	)[0])
	if mediaType != "application/json" {
		return fmt.Errorf("Content-Type must be application/json")
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("multiple JSON values")
		}
		return err
	}
	return nil
}

// Empty writes a bodyless success response. It exists so that an exit
// carrying no payload is still recorded like every other handler exit.
func (s *Runtime) Empty(
	ctx context.Context, w http.ResponseWriter, status int,
) {
	w.WriteHeader(status)
	s.InfoContext(
		ctx, "empty response",
		"event", "empty_response",
		"status", status,
	)
}

func (s *Runtime) JSON(
	ctx context.Context, w http.ResponseWriter, status int, value any,
) {
	b, err := json.Marshal(value)
	if err != nil {
		s.ErrorContext(
			ctx, "encode JSON response",
			"event", "response_encode_error",
			"error", err,
		)
		s.InternalError(ctx, w, "marshal JSON response", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if _, err := w.Write(b); err != nil {
		// The status line and headers are already on the wire, so the response
		// cannot be replaced with a problem document. Report the failure.
		s.ErrorContext(
			ctx, "write JSON response",
			"event", "request_error",
			"operation", "write JSON response",
			"status", status,
			"error", err,
		)
		return
	}
	// Pairs with the Problem record so every handler exit, successful or not,
	// leaves one traceable line. The encoded value is never logged; it carries
	// session tokens and other credentials.
	s.InfoContext(
		ctx, "JSON response",
		"event", "json_response",
		"status", status,
	)
}
