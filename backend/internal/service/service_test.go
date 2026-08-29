package service

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func freeAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return address
}

func TestListenAndServeShutsDownWhenTheContextIsCancelled(t *testing.T) {
	var logged bytes.Buffer
	log := slog.New(slog.NewTextHandler(&logged, nil))
	address := freeAddress(t)
	ctx, cancel := context.WithCancel(t.Context())

	served := make(chan error, 1)
	go func() {
		served <- ListenAndServe(ctx, log, address, http.HandlerFunc(
			func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			},
		))
	}()

	client := http.Client{Timeout: 2 * time.Second}
	var response *http.Response
	var err error
	// The listener opens asynchronously, so retry until it answers.
	for range 50 {
		response, err = client.Get("http://" + address + "/")
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("server never accepted a request: %v", err)
	}
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d", response.StatusCode)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()

	cancel()
	select {
	case err := <-served:
		if err != nil {
			t.Fatalf("ListenAndServe() = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ListenAndServe did not return after cancellation")
	}
	if !strings.Contains(logged.String(), "shutdown") {
		t.Fatalf("log = %s", logged.String())
	}
}

func TestListenAndServeReportsAnUnusableAddress(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	err := ListenAndServe(
		t.Context(), log, "127.0.0.1:not-a-port", http.NewServeMux(),
	)
	if err == nil {
		t.Fatal("ListenAndServe() accepted an unusable address")
	}
}

func TestWithTenantBindsTheTenantToEveryRecord(t *testing.T) {
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })
	var logged bytes.Buffer
	log := WithTenant(slog.New(slog.NewTextHandler(&logged, nil)), "sgp")
	log.Info("started")
	slog.Info("started through the default logger")
	if strings.Count(logged.String(), "tenant=sgp") != 2 {
		t.Fatalf("log = %s", logged.String())
	}
}
