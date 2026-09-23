package objectstorage

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestSignGetUsesBrowserOriginAndTenMinuteExpiry(t *testing.T) {
	client, err := New(
		"http://seaweed-s3-sgp:8333", "https://media.sgp.vetchium.com",
		"testaccesskey1234", "testsecretkey1234567890123456789012",
	)
	if err != nil {
		t.Fatal(err)
	}
	id := pgtype.UUID{Bytes: [16]byte{1, 2, 3}, Valid: true}
	signed, err := client.SignGet(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(signed)
	if err != nil {
		t.Fatal(err)
	}
	if u.Scheme != "https" || u.Host != "media.sgp.vetchium.com" ||
		u.Path != "/hub-profile-pictures/01020300-0000-0000-0000-000000000000" ||
		u.Query().Get("X-Amz-Expires") != "600" ||
		u.Query().Get("X-Amz-Signature") == "" ||
		!strings.Contains(u.Query().Get("X-Amz-Credential"), "testaccesskey1234") ||
		strings.Contains(signed, "testsecretkey") {
		t.Fatalf("invalid signed media URL: %s", signed)
	}
}

func TestClientRejectsMissingCredentialsAndUnsafeOrigins(t *testing.T) {
	for _, tc := range []struct {
		private string
		media   string
		key     string
		secret  string
	}{
		{"http://s3:8333", "https://media.example.com", "", ""},
		{"http://s3:8333/path", "https://media.example.com", "testaccesskey1234", "testsecretkey1234567890123456789012"},
		{"http://s3:8333", "https://media.example.com/?bucket=all", "testaccesskey1234", "testsecretkey1234567890123456789012"},
		{"http://s3:8333", "https://user@media.example.com", "testaccesskey1234", "testsecretkey1234567890123456789012"},
	} {
		if _, err := New(tc.private, tc.media, tc.key, tc.secret); err == nil {
			t.Errorf("accepted unsafe object-storage configuration: %+v", tc)
		}
	}
}
