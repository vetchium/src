package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/rs/xid"
)

type ctxKey string

const loggerKey ctxKey = "logger"

const (
	adminSessionKey  ctxKey = "adminSession"
	adminUserKey     ctxKey = "adminUser"
	hubSessionKey    ctxKey = "hubSession"
	hubUserKey       ctxKey = "hubUser"
	hubRegionKey     ctxKey = "hubRegion"
	orgSessionKey    ctxKey = "orgSession"
	orgUserKey       ctxKey = "orgUser"
	orgRegionKey     ctxKey = "orgRegion"
	agencySessionKey ctxKey = "agencySession"
	agencyUserKey    ctxKey = "agencyUser"
	agencyRegionKey  ctxKey = "agencyRegion"
)

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// RequestID is a middleware that injects a request ID into the context,
// creates a logger with the request ID, and logs each request.
func RequestID(baseLogger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Check for existing request ID header or generate new one
			requestID := r.Header.Get("X-Request-ID")
			if requestID == "" {
				requestID = xid.New().String()
			}

			// Create logger with request_id attribute
			logger := baseLogger.With("request_id", requestID)

			// Add request ID to response header for debugging
			w.Header().Set("X-Request-ID", requestID)
			// Expose header to browsers (CORS)
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")

			// Wrap response writer to capture status code
			wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

			// Store logger in context
			ctx := context.WithValue(r.Context(), loggerKey, logger)

			// Process request
			next.ServeHTTP(wrapped, r.WithContext(ctx))

			// Log request completion
			duration := time.Since(start)
			logger.Info("request completed",
				"method", r.Method,
				"path", r.URL.Path,
				"status", wrapped.statusCode,
				"duration_ms", duration.Milliseconds(),
			)
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
