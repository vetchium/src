package middleware

import (
	"bytes"
	"net/http"

	"backend/internal/httpx"
)

// ProblemRouteErrors replaces ServeMux's plain-text errors with RFC 9457
// problem details. Registered handlers are still dispatched by ServeMux so
// wildcard path values and the matched request pattern are preserved.
func ProblemRouteErrors(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, pattern := mux.Handler(r)
		if pattern != "" {
			mux.ServeHTTP(w, r)
			return
		}

		probe := &routeErrorProbe{header: make(http.Header)}
		mux.ServeHTTP(probe, r)
		if probe.status < http.StatusBadRequest {
			copyHeader(w.Header(), probe.header)
			w.WriteHeader(probe.status)
			_, _ = w.Write(probe.body.Bytes())
			return
		}

		copyHeader(w.Header(), probe.header)
		w.Header().Del("Content-Length")
		w.Header().Del("Content-Type")
		detail := "The request could not be completed."
		switch probe.status {
		case http.StatusNotFound:
			detail = "The requested resource was not found."
		case http.StatusMethodNotAllowed:
			detail = "The requested method is not supported for this resource."
		}
		httpx.WriteProblem(w, probe.status, detail)
	})
}

type routeErrorProbe struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (p *routeErrorProbe) Header() http.Header { return p.header }

func (p *routeErrorProbe) WriteHeader(status int) { p.status = status }

func (p *routeErrorProbe) Write(body []byte) (int, error) {
	if p.status == 0 {
		p.status = http.StatusOK
	}
	return p.body.Write(body)
}

func copyHeader(destination, source http.Header) {
	for key, values := range source {
		for _, value := range values {
			destination.Add(key, value)
		}
	}
}
