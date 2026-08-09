package apiserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

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
		s.InternalError(ctx, w, "JSON Marshal", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_, err = w.Write(b)
	if err != nil {
		s.InternalError(ctx, w, "JSON Marshal", err)
	}
}
