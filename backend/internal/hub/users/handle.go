package users

import (
	"crypto/rand"
	"math/big"
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
// from a handle. The global directory enforces uniqueness, and the signup
// completion saga retries a collision with a fresh suffix.
const suffixLength = 11

// prefixLength is the fixed width of the display-name section of a handle.
const prefixLength = 8

// fallbackPrefix is used when the display name has no ASCII letter or digit
// to take, such as a name written wholly in a non-Latin script. Transliteration
// is deliberately not attempted.
const fallbackPrefix = "user"

// Handle builds the public handle for a new Hub User: an eight-character
// prefix, a hyphen and the random suffix. The prefix is the first eight ASCII
// letters and digits of the display name; any other character is skipped. Random
// digits fill any shortfall, so the prefix is always eight characters. A name
// with no ASCII letter or digit uses "user" in their place. The random suffix
// keeps the handle unique and opaque.
func Handle(displayName string) (hub.HubHandle, error) {
	prefix := namePrefix(displayName)
	if prefix == "" {
		prefix = fallbackPrefix
	}
	padding, err := randomDigits(prefixLength - len(prefix))
	if err != nil {
		return "", err
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
	return hub.HubHandle(prefix + padding + "-" + string(suffix)), nil
}

func namePrefix(displayName string) string {
	prefix := make([]byte, 0, prefixLength)
	for _, character := range strings.ToLower(displayName) {
		if len(prefix) == prefixLength {
			break
		}
		if character >= 'a' && character <= 'z' ||
			character >= '0' && character <= '9' {
			prefix = append(prefix, byte(character))
		}
	}
	return string(prefix)
}

func randomDigits(count int) (string, error) {
	digits := make([]byte, count)
	ten := big.NewInt(10)
	for index := range digits {
		digit, err := rand.Int(rand.Reader, ten)
		if err != nil {
			return "", err
		}
		digits[index] = byte('0' + digit.Int64())
	}
	return string(digits), nil
}
