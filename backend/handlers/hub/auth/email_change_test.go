package auth

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

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
