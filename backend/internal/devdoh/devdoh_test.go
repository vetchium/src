package devdoh

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// echoUpstream answers each TCP-framed query with the same message and the
// QR bit set, which is enough to show the bytes went through unchanged.
func echoUpstream(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer func() { _ = conn.Close() }()
				var size [2]byte
				if _, err := io.ReadFull(conn, size[:]); err != nil {
					return
				}
				message := make([]byte, binary.BigEndian.Uint16(size[:]))
				if _, err := io.ReadFull(conn, message); err != nil {
					return
				}
				message[2] |= 0x80
				_, _ = conn.Write(append(size[:], message...))
			}()
		}
	}()
	return listener.Addr().String()
}

func query(t *testing.T, handler http.Handler, dns string) *http.Response {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet, "/dns-query?dns="+dns, nil,
	))
	return recorder.Result()
}

func TestHandlerForwardsTheQuery(t *testing.T) {
	t.Parallel()
	message := []byte{0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 16, 0, 1}
	response := query(t,
		Handler(echoUpstream(t), time.Second),
		base64.RawURLEncoding.EncodeToString(message),
	)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	for name, want := range map[string]string{
		"Content-Type":                "application/dns-message",
		"Access-Control-Allow-Origin": "*",
		"Cache-Control":               "no-store",
	} {
		if got := response.Header.Get(name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Clone(message)
	want[2] |= 0x80
	if !bytes.Equal(body, want) {
		t.Fatalf("answer = %v, want %v", body, want)
	}
}

func TestHandlerRejectsMalformedQueries(t *testing.T) {
	t.Parallel()
	handler := Handler(echoUpstream(t), time.Second)
	for _, dns := range []string{"", "not%20base64!", "AAAA"} {
		if got := query(t, handler, dns).StatusCode; got != http.StatusBadRequest {
			t.Errorf("dns=%q status = %d, want 400", dns, got)
		}
	}
}

func TestHandlerReportsAnUnreachableUpstream(t *testing.T) {
	t.Parallel()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	response := query(t,
		Handler(address, time.Second),
		base64.RawURLEncoding.EncodeToString(make([]byte, headerSize)),
	)
	if response.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", response.StatusCode)
	}
}
