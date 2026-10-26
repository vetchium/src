// Package meshwire is the transport that durable commands and outbox events
// share between a tenant's API servers and workers, its mesh relay, and other
// tenants' peer listeners.
package meshwire

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync/atomic"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/problem"
)

const maxResponseBytes = 1 << 20

var (
	// ErrNotSent reports a routing or connection failure before the request
	// was transmitted, so the receiver certainly did not act on it.
	ErrNotSent = errors.New("federation request not sent")
	// ErrOutcomeUnknown reports a request that may have been transmitted
	// without a definite answer coming back.
	ErrOutcomeUnknown = errors.New("federation request outcome unknown")
)

// PeerURL is path on tenant's peer listener; the TLS server name is
// PeerServerName(tenant).
func PeerURL(tenant directoryspec.TenantID, path string) string {
	return "https://" + PeerServerName(tenant) + ":8443" + path
}

func PeerServerName(tenant directoryspec.TenantID) string {
	return string(tenant) + ".mesh.vetchium.com"
}

// RelayURL is path on the tenant-local relay at baseURL.
func RelayURL(baseURL, path string) string {
	return strings.TrimRight(baseURL, "/") + path
}

// PeerTLS is base for one peer tenant, or nil when the peer cannot be
// addressed.
func PeerTLS(base *tls.Config, tenant directoryspec.TenantID) *tls.Config {
	if !directoryspec.IsTenantID(tenant) || base == nil {
		return nil
	}
	config := base.Clone()
	config.ServerName = PeerServerName(tenant)
	return config
}

type Exchange struct {
	Status    int
	MediaType string
	Body      []byte
}

// JSON decodes a 200 application/json body strictly into value.
func (e Exchange) JSON(value any) bool {
	return e.Status == http.StatusOK && e.MediaType == "application/json" &&
		DecodeStrict(e.Body, value) == nil
}

// Problem returns a well-formed RFC 9457 body whose status matches the
// response.
func (e Exchange) Problem() (problem.Details, bool) {
	var details problem.Details
	if e.MediaType != problem.MediaType ||
		json.Unmarshal(e.Body, &details) != nil ||
		details.Status != e.Status || details.Type == "" {
		return problem.Details{}, false
	}
	return details, true
}

// Post classifies a failure by whether the whole request was written: an
// unwritten request cannot have been acted on, a written one may have.
func Post(
	ctx context.Context, endpoint, credential string, tlsConfig *tls.Config,
	timeout time.Duration, payload any,
) (Exchange, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return Exchange{}, fmt.Errorf("%w: encode: %v", ErrNotSent, err)
	}
	var written atomic.Bool
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			if info.Err == nil {
				written.Store(true)
			}
		},
	})
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint, bytes.NewReader(body),
	)
	if err != nil {
		return Exchange{}, fmt.Errorf("%w: %v", ErrNotSent, err)
	}
	request.Header.Set("Content-Type", "application/json")
	if credential != "" {
		request.Header.Set("Authorization", "Bearer "+credential)
	}
	// A fresh transport per request never reuses a connection, so a written
	// request is never silently retried on another one.
	transport := &http.Transport{TLSClientConfig: tlsConfig}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Timeout: timeout, Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		if !written.Load() {
			return Exchange{}, fmt.Errorf("%w: %v", ErrNotSent, err)
		}
		return Exchange{}, fmt.Errorf("%w: %v", ErrOutcomeUnknown, err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return Exchange{}, fmt.Errorf("%w: unreadable response", ErrOutcomeUnknown)
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	return Exchange{
		Status: response.StatusCode, MediaType: mediaType, Body: data,
	}, nil
}

func DecodeStrict(data []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("trailing data")
	}
	return nil
}

// Canonical re-encodes JSON with sorted keys and encoding/json escaping, so
// a digest over it survives relaying and re-encoding.
func Canonical(value json.RawMessage) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(value))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return nil, fmt.Errorf("decode federation payload: %w", err)
	}
	return json.Marshal(decoded)
}
