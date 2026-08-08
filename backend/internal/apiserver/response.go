package apiserver

import (
	"context"
	"encoding/json"
	"net/http"

	problemspec "github.com/vetchium/src/typespec/problem"
)

// Unauthorized writes a bodyless 401 response with the Bearer challenge
// required by RFC 9110 for a 401 response.
func (s *Runtime) Unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="login"`)
	w.WriteHeader(http.StatusUnauthorized)
}

func (s *Runtime) InternalError(
	ctx context.Context, w http.ResponseWriter,
	operation string, err error, attrs ...any,
) {
	logAttrs := []any{
		"event", "request_error",
		"operation", operation,
		"error", err,
	}
	logAttrs = append(logAttrs, attrs...)
	s.ErrorContext(ctx, "request failed", logAttrs...)

	w.Header().Set("Content-Type", problemspec.MediaType)
	w.WriteHeader(http.StatusInternalServerError)
	if err := json.NewEncoder(w).Encode(
		problemspec.InternalServerError,
	); err != nil {
		s.ErrorContext(
			ctx, "encode internal error response",
			"event", "response_encode_error",
			"error", err,
		)
	}
}

func (s *Runtime) InvalidJSON(
	ctx context.Context, w http.ResponseWriter, err error,
) {
	s.WarnContext(
		ctx, "invalid JSON request",
		"event", "invalid_json",
		"error", err,
	)
	w.Header().Set("Content-Type", problemspec.MediaType)
	w.WriteHeader(http.StatusBadRequest)
	if err := json.NewEncoder(w).Encode(problemspec.InvalidJSONError); err != nil {
		s.ErrorContext(
			ctx, "encode invalid JSON response",
			"event", "response_encode_error",
			"error", err,
		)
	}
}

func (s *Runtime) ValidationFailed(
	ctx context.Context, w http.ResponseWriter, fields []string,
) {
	w.Header().Set("Content-Type", problemspec.MediaType)
	w.WriteHeader(http.StatusBadRequest)
	details := problemspec.ValidationFailedError
	details.Fields = fields
	if err := json.NewEncoder(w).Encode(details); err != nil {
		s.ErrorContext(
			ctx, "encode validation failed response",
			"event", "response_encode_error",
			"error", err,
		)
	}
}
