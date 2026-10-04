// Package devdoh answers DNS-over-HTTPS (RFC 8484) GET queries from the
// development DNS server, so the Orgs portal can look up a signup's TXT
// record in development and CI the way it does through a public resolver in
// production. It is built only into the development stacks.
package devdoh

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"time"

	"backend/internal/apiserver"
)

// headerSize is a DNS message header; anything shorter is not a query.
const headerSize = 12

// Handler forwards each query to upstream over TCP, the transport whose
// framing carries any message size, and returns the answer unchanged.
func Handler(upstream string, timeout time.Duration) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc(
		"GET /dns-query", func(w http.ResponseWriter, r *http.Request) {
			// Public resolvers let any origin read answers; the portal
			// relies on the same here.
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Cache-Control", "no-store")
			query, err := base64.RawURLEncoding.DecodeString(
				r.URL.Query().Get("dns"),
			)
			if err != nil || len(query) < headerSize ||
				len(query) > 0xffff {
				http.Error(w, "invalid dns parameter", http.StatusBadRequest)
				return
			}
			answer, err := exchange(r.Context(), upstream, timeout, query)
			if err != nil {
				http.Error(w, "upstream DNS failed", http.StatusBadGateway)
				return
			}
			w.Header().Set("Content-Type", "application/dns-message")
			_, _ = w.Write(answer)
		},
	)
	return mux
}

func exchange(
	ctx context.Context, upstream string, timeout time.Duration,
	query []byte,
) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", upstream)
	if err != nil {
		return nil, err
	}
	defer func() { _ = conn.Close() }()
	if deadline, ok := ctx.Deadline(); ok {
		if err := conn.SetDeadline(deadline); err != nil {
			return nil, err
		}
	}
	frame := binary.BigEndian.AppendUint16(nil, uint16(len(query)))
	if _, err := conn.Write(append(frame, query...)); err != nil {
		return nil, err
	}
	var size [2]byte
	if _, err := io.ReadFull(conn, size[:]); err != nil {
		return nil, err
	}
	answer := make([]byte, binary.BigEndian.Uint16(size[:]))
	if _, err := io.ReadFull(conn, answer); err != nil {
		return nil, err
	}
	return answer, nil
}
