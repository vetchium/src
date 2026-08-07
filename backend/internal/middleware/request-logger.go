package middleware

import (
	"net/http"
	"runtime/debug"

	"backend/internal/apiserver"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httplog/v3"
)

func RequestLogger(runtime *apiserver.Runtime) func(http.Handler) http.Handler {
	logged := httplog.RequestLogger(runtime.Logger, &httplog.Options{RecoverPanics: false})
	return func(next http.Handler) http.Handler {
		return logged(recoverProblems(runtime, next))
	}
}

func recoverProblems(runtime *apiserver.Runtime, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wrapped := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
		defer func() {
			if recovered := recover(); recovered != nil {
				if recovered == http.ErrAbortHandler {
					panic(recovered)
				}
				runtime.ErrorContext(r.Context(), "panic recovered", "panic", recovered, "stack", string(debug.Stack()))
				if wrapped.Status() == 0 {
					wrapped.Header().Set("Cache-Control", "no-store")
					runtime.InternalError(wrapped)
				}
			}
		}()
		next.ServeHTTP(wrapped, r)
	})
}
