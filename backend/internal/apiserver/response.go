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
	s.Problem(
		context.Background(), w,
		problemspec.Details{
			Type:   "vetchium-problem-details/admin-authentication-required",
			Title:  "Admin authentication required",
			Status: http.StatusUnauthorized,
			Detail: "A valid admin bearer session is required",
		},
		`Bearer realm="admin"`,
	)
}

func (s *Runtime) Problem(
	ctx context.Context, w http.ResponseWriter, details problemspec.Details,
	wwwAuthenticate ...string,
) {
	w.Header().Set("Content-Type", problemspec.MediaType)
	if len(wwwAuthenticate) != 0 {
		w.Header().Set("WWW-Authenticate", wwwAuthenticate[0])
	}
	w.WriteHeader(details.Status)
	if err := json.NewEncoder(w).Encode(details); err != nil {
		s.ErrorContext(
			ctx, "encode problem response",
			"event", "response_encode_error",
			"problem_type", details.Type,
			"error", err,
		)
	}
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

	s.Problem(ctx, w, problemspec.InternalServerError)
}

func (s *Runtime) InvalidJSON(
	ctx context.Context, w http.ResponseWriter, err error,
) {
	s.WarnContext(
		ctx, "invalid JSON request",
		"event", "invalid_json",
		"error", err,
	)
	s.Problem(ctx, w, problemspec.InvalidJSONError)
}

func (s *Runtime) ValidationFailed(
	ctx context.Context, w http.ResponseWriter, fields []string,
) {
	details := problemspec.ValidationFailedError
	details.Fields = fields
	s.Problem(ctx, w, details)
}
