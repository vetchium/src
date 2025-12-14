package middleware

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/rs/xid"
)

type ctxKey string

const loggerKey ctxKey = "logger"

// RequestID is a middleware that injects a request ID into the context
// and creates a logger with the request ID for structured logging.
func RequestID(baseLogger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check for existing request ID header or generate new one
			requestID := r.Header.Get("X-Request-ID")
			if requestID == "" {
				requestID = xid.New().String()
			}

			// Create logger with request_id attribute
			logger := baseLogger.With("request_id", requestID)

			// Add request ID to response header for debugging
			w.Header().Set("X-Request-ID", requestID)

			// Store logger in context
			ctx := context.WithValue(r.Context(), loggerKey, logger)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// LoggerFromContext retrieves the logger from context.
// Falls back to the provided default logger if not found.
func LoggerFromContext(ctx context.Context, defaultLogger *slog.Logger) *slog.Logger {
	if logger, ok := ctx.Value(loggerKey).(*slog.Logger); ok {
		return logger
	}
	return defaultLogger
}
