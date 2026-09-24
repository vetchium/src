package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/vetchium/src/typespec/problem"
)

// The stub server has no database, so reaching the transaction would panic:
// these cases prove validation rejects before any side effect.
func TestEmailChangeRejectsInvalidRequestsBeforeWork(t *testing.T) {
	for _, test := range []struct {
		name    string
		handler http.Handler
		body    string
		fields  []string
	}{
		{
			name:    "request with malformed address",
			handler: RequestEmailChange(hubTestServer(&hubDBStub{}, time.Now())),
			body:    `{"new_email_address":"not-an-address"}`,
			fields:  []string{"new_email_address"},
		},
		{
			name:    "confirm with malformed challenge and code",
			handler: ConfirmEmailChange(hubTestServer(&hubDBStub{}, time.Now())),
			body:    `{"challenge_id":"bad","code":"12a"}`,
			fields:  []string{"challenge_id", "code"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := hubJSONRequest(t, test.handler, test.body)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s",
					response.Code, response.Body.String())
			}
			var details problem.Details
			if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
				t.Fatal(err)
			}
			if details.Type != problem.ValidationFailedError.Type ||
				!slices.Equal(details.Fields, test.fields) {
				t.Fatalf("problem = %+v", details)
			}
		})
	}
}

func TestIsAccountEmailTaken(t *testing.T) {
	taken := &pgconn.PgError{
		Code: "23505", ConstraintName: "hub_users_email_address_key",
	}
	if !isAccountEmailTaken(fmt.Errorf("confirm: %w", taken)) {
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
