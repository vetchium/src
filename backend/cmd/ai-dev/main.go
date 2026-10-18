// Command ai-dev stands in for a model server in development and CI. With
// AI_DEV_UPSTREAM set it relays to that server, such as Docker Model Runner on
// the developer's machine, which the internal tenant networks cannot reach;
// otherwise it serves deterministic fake completions for tests. It is never
// deployed.
package main

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"

	"backend/internal/chatmodel/fake"
	"backend/internal/service"
)

func main() {
	service.Main("ai-dev", run)
}

func run(log *slog.Logger, address string) error {
	handler := fake.Handler()
	if upstream := os.Getenv("AI_DEV_UPSTREAM"); upstream != "" {
		target, err := url.Parse(upstream)
		if err != nil {
			return err
		}
		mux := http.NewServeMux()
		mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})
		mux.Handle("/", httputil.NewSingleHostReverseProxy(target))
		handler = mux
		log.Info("relaying to model server", "event", "ai_dev_relay",
			"upstream", target.Redacted())
	}
	ctx, stop := service.SignalContext()
	defer stop()
	return service.ListenAndServe(ctx, log, address, handler)
}
