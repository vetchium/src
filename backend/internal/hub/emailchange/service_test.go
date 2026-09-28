package emailchange

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
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
