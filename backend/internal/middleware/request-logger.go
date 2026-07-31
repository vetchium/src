package middleware

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/httplog/v3"
)

func RequestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return httplog.RequestLogger(log, &httplog.Options{RecoverPanics: true})
}
