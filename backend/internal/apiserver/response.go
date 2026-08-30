package apiserver

import (
	"context"
	"encoding/json"
	"net/http"

	problemspec "github.com/vetchium/src/typespec/problem"
)

// Problem writes one RFC 9457 response for a rejection that carries no
// authentication challenge. A 401 belongs in AuthenticationProblem instead.
func (s *Runtime) Problem(
	ctx context.Context, w http.ResponseWriter, details problemspec.Details,
) {
	s.problem(ctx, w, details, "")
}

// AuthenticationProblem writes a 401 together with the WWW-Authenticate
// challenge that RFC 9110 section 11.6.1 requires every 401 to carry. It is
// the Go counterpart of the AuthenticationResponse alias in the TypeSpec
// contract, which declares the same header.
func (s *Runtime) AuthenticationProblem(
	ctx context.Context, w http.ResponseWriter, details problemspec.Details,
	challenge string,
) {
	s.problem(ctx, w, details, challenge)
}

func (s *Runtime) problem(
	ctx context.Context, w http.ResponseWriter,
	details problemspec.Details, challenge string,
) {
	if details.Status == http.StatusUnauthorized && challenge == "" {
		s.ErrorContext(
			ctx, "401 without an authentication challenge",
			"event", "missing_authentication_challenge",
			"problem_type", details.Type,
		)
	}

	attrs := []any{
		"event", "problem_response",
		"problem_type", details.Type,
		"status", details.Status,
	}
	if len(details.Fields) != 0 {
		attrs = append(attrs, "fields", details.Fields)
	}
	if details.Status >= http.StatusInternalServerError {
		// InternalError already reported the cause, so record only the reply.
		s.WarnContext(ctx, "problem response", attrs...)
	} else {
		s.InfoContext(ctx, "problem response", attrs...)
	}

	w.Header().Set("Content-Type", problemspec.MediaType)
	if challenge != "" {
		w.Header().Set("WWW-Authenticate", challenge)
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
