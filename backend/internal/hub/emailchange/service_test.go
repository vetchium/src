package emailchange

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

func TestIsAccountEmailTaken(t *testing.T) {
	taken := &pgconn.PgError{
		Code: "23505", ConstraintName: "hub_users_email_address_key",
	}
	if !isAccountEmailTaken(fmt.Errorf("apply: %w", taken)) {
		t.Fatal("wrapped account email violation was not recognized")
	}
	for _, err := range []error{
		nil,
		errors.New("connection reset"),
		&pgconn.PgError{Code: "23505", ConstraintName: "hub_users_handle_key"},
		&pgconn.PgError{
			Code: "23503", ConstraintName: "hub_users_email_address_key",
		},
	} {
		if isAccountEmailTaken(err) {
			t.Errorf("misclassified %v as a taken address", err)
		}
	}
}

func TestIsEmailChangeInProgress(t *testing.T) {
	live := &pgconn.PgError{
		Code: "23505", ConstraintName: "hub_account_email_changes_one_live",
	}
	if !isEmailChangeInProgress(fmt.Errorf("accept: %w", live)) {
		t.Fatal("wrapped one-live violation was not recognized")
	}
	for _, err := range []error{
		nil,
		errors.New("connection reset"),
		&pgconn.PgError{
			Code: "23505", ConstraintName: "hub_users_email_address_key",
		},
	} {
		if isEmailChangeInProgress(err) {
			t.Errorf("misclassified %v as an in-progress change", err)
		}
	}
}

func TestFailureStatus(t *testing.T) {
	if got := failureStatus("address_unavailable"); got != 409 {
		t.Fatalf("failureStatus(address_unavailable) = %d, want 409", got)
	}
	if got := failureStatus("reservation_expired"); got != 503 {
		t.Fatalf("failureStatus(reservation_expired) = %d, want 503", got)
	}
}

func TestDirectoryRefusalsLogAtErrorLevel(t *testing.T) {
	var output bytes.Buffer
	service := &Service{log: slog.New(slog.NewJSONHandler(&output, nil))}
	operationID, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	change := Change{
		OperationID: operationID,
		State:       sqlc.VetchiumHubAccountEmailChangeStateApplied,
	}
	for _, test := range []struct {
		name   string
		send   func() (Result, error)
		level  string
		event  string
		detail string
		value  string
	}{
		{
			name: "refused",
			send: func() (Result, error) {
				return service.directoryRefused(
					context.Background(), change, "finalize",
					coordinatorproblem.DirectoryStateConflictError.Type,
				)
			},
			level: "ERROR", event: "hub_email_change_directory_refused",
			detail: "problemType",
			value:  coordinatorproblem.DirectoryStateConflictError.Type,
		},
		{
			name: "unreachable",
			send: func() (Result, error) {
				return service.directoryUnreachable(
					context.Background(), change, "finalize",
					errors.New("connection reset"),
				)
			},
			level: "WARN", event: "hub_email_change_directory_pending",
			detail: "error", value: "connection reset",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			output.Reset()
			result, err := test.send()
			if !errors.Is(err, ErrPending) ||
				result.OperationID != dbvalue.FormatUUID(operationID) {
				t.Fatalf("result = %+v, %v, want pending", result, err)
			}
			var record map[string]any
			if err := json.Unmarshal(output.Bytes(), &record); err != nil {
				t.Fatalf("log output %q: %v", output.String(), err)
			}
			if record["level"] != test.level || record["event"] != test.event ||
				record["command"] != "finalize" ||
				record["operationID"] != dbvalue.FormatUUID(operationID) ||
				record["state"] != "applied" ||
				record[test.detail] != test.value {
				t.Fatalf("log record = %v", record)
			}
		})
	}
}
