package proxy

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// BufferBody reads and returns the request body, then restores it on the request
// so it can be read again by the handler.
func BufferBody(r *http.Request) ([]byte, error) {
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	return bodyBytes, nil
}

// ToRegion proxies the request to the specified region's internal endpoint.
// bodyBytes is the original request body (already consumed by the handler).
func ToRegion(w http.ResponseWriter, r *http.Request, targetURL string, bodyBytes []byte) {
	target, err := url.Parse(targetURL)
	if err != nil {
		http.Error(w, "", http.StatusInternalServerError)
		return
	}

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.URL.Path = r.URL.Path
			req.URL.RawQuery = r.URL.RawQuery
			req.Host = target.Host

			// Restore the original body
			req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			req.ContentLength = int64(len(bodyBytes))

			// Copy all original headers (including Authorization)
			for key, values := range r.Header {
				for _, value := range values {
					req.Header.Set(key, value)
				}
			}
		},
	}
	proxy.ServeHTTP(w, r)
}
