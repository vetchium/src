package middleware

import (
	"fmt"
	"net/http"
	"runtime/debug"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httplog/v3"

	"backend/internal/apiserver"
)

func RequestLogger(runtime *apiserver.Runtime) func(http.Handler) http.Handler {
	options := &httplog.Options{RecoverPanics: false}
	logged := httplog.RequestLogger(runtime.Logger, options)
	return func(next http.Handler) http.Handler {
		return logged(recoverProblems(runtime, next))
	}
}

func recoverProblems(
	runtime *apiserver.Runtime, next http.Handler,
) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		wrapped := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
		defer func() {
			if recovered := recover(); recovered != nil {
				if recovered == http.ErrAbortHandler {
					panic(recovered)
				}
				if wrapped.Status() == 0 {
					header := wrapped.Header()
					header.Set("Cache-Control", "no-store")
					panicErr := fmt.Errorf("panic: %v", recovered)
					runtime.InternalError(
						ctx,
						wrapped,
						"serve HTTP request",
						panicErr,
						"panic", recovered,
						"stack", string(debug.Stack()),
					)
				} else {
					panicErr := fmt.Errorf("panic: %v", recovered)
					stack := string(debug.Stack())
					runtime.ErrorContext(
						ctx, "panic after response started",
						"event", "request_error",
						"operation", "serve HTTP request",
						"error", panicErr,
						"panic", recovered,
						"stack", stack,
					)
				}
			}
		}()
		next.ServeHTTP(wrapped, r)
	})
}
