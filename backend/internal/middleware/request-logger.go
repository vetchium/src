package middleware

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httplog/v3"
	problemspec "github.com/vetchium/src/typespec/problem"
)

func RequestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	logged := httplog.RequestLogger(log, &httplog.Options{RecoverPanics: false})
	return func(next http.Handler) http.Handler {
		return logged(recoverProblems(log, next))
	}
}

func recoverProblems(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wrapped := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
		defer func() {
			if recovered := recover(); recovered != nil {
				if recovered == http.ErrAbortHandler {
					panic(recovered)
				}
				log.ErrorContext(r.Context(), "panic recovered", "panic", recovered, "stack", string(debug.Stack()))
				if wrapped.Status() == 0 {
					wrapped.Header().Set("Cache-Control", "no-store")
					wrapped.Header().Set("Content-Type", problemspec.MediaType)
					wrapped.WriteHeader(http.StatusInternalServerError)
					_, _ = wrapped.Write([]byte(problemspec.InternalServerErrorBody))
				}
			}
		}()
		next.ServeHTTP(wrapped, r)
	})
}
