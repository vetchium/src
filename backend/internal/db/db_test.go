package db

import (
	"bytes"
	"context"
	"log/slog"
	"testing"
)

func TestConnectKeepsPoolWhenDatabaseIsUnavailable(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	pool, err := Connect(
		context.Background(),
		"postgresql://user:password@127.0.0.1:1/database"+
			"?sslmode=disable&connect_timeout=1",
		logger,
	)
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	defer pool.Close()

	if !bytes.Contains(logs.Bytes(), []byte("database unavailable")) {
		t.Fatalf("log = %q, want database unavailable warning", logs.String())
	}
}

func TestConnectSetsBoundedConnectionTimeout(t *testing.T) {
	pool, err := Connect(
		context.Background(),
		"postgresql://user:password@127.0.0.1:1/database"+
			"?sslmode=disable",
		slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
	)
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	defer pool.Close()

	connectTimeout := pool.Config().ConnConfig.ConnectTimeout
	if connectTimeout != databaseConnectTimeout {
		t.Fatalf(
			"ConnectTimeout = %s, want %s",
			connectTimeout, databaseConnectTimeout,
		)
	}
	if got := pool.Config().PingTimeout; got != databaseConnectTimeout {
		t.Fatalf("PingTimeout = %s, want %s", got, databaseConnectTimeout)
	}
}

func TestConnectRejectsInvalidConfiguration(t *testing.T) {
	pool, err := Connect(
		context.Background(),
		"postgresql://%zz",
		slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
	)
	if err == nil {
		pool.Close()
		t.Fatal("Connect() error = nil, want configuration error")
	}
}
