package users

import (
	"crypto/rand"
	"strings"

	"github.com/vetchium/src/typespec/hub"
)

// suffixAlphabet is Crockford base32: the decimal digits and the lowercase
// letters that survive being read aloud or copied by hand, so i, l, o and u
// are absent.
const suffixAlphabet = "0123456789abcdefghjkmnpqrstvwxyz"

// suffixLength gives the suffix 55 bits of entropy. The handle is a public
// identifier, so the suffix is random rather than derived from the DID or the
// clock: neither the account identifier nor its creation time may be readable
// from a handle. Uniqueness is enforced by the hub_users unique index, and
// CompleteHubSignup retries a collision with a fresh suffix.
const suffixLength = 11

// Handle builds the public handle for a new Hub User. The display-name prefix
// keeps it recognizable; the random suffix keeps it unique and opaque.
func Handle(displayName string) (hub.HubHandle, error) {
	prefix := make([]byte, 0, 5)
	for _, character := range strings.ToLower(displayName) {
		if len(prefix) == 5 {
			break
		}
		if character >= 'a' && character <= 'z' ||
			character >= '0' && character <= '9' {
			prefix = append(prefix, byte(character))
		}
	}
	for len(prefix) < 5 {
		prefix = append(prefix, 'x')
	}
	suffix := make([]byte, suffixLength)
	if _, err := rand.Read(suffix); err != nil {
		return "", err
	}
	// The alphabet has 32 entries and a byte has 256 values, so masking the
	// low five bits stays uniform without rejection sampling.
	for index, value := range suffix {
		suffix[index] = suffixAlphabet[value&31]
	}
	return hub.HubHandle(string(prefix) + "-" + string(suffix)), nil
}
