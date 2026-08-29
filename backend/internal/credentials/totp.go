package credentials

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// totpSkew is how many 30-second steps either side of the current one are
// accepted, which absorbs ordinary clock drift on the authenticator device.
const totpSkew = 1

// totpDigits is the code length advertised in the provisioning URI.
const totpDigits = 6

var totpEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

func NewTOTPSecret() (string, error) {
	secret := make([]byte, 20)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate TOTP secret: %w", err)
	}
	return totpEncoding.EncodeToString(secret), nil
}

func TOTPProvisioningURI(email, issuer, secret string) string {
	label := url.PathEscape(issuer + ":" + email)
	query := url.Values{
		"secret":    []string{secret},
		"issuer":    []string{issuer},
		"algorithm": []string{"SHA1"},
		"digits":    []string{strconv.Itoa(totpDigits)},
		"period":    []string{"30"},
	}
	return "otpauth://totp/" + label + "?" + query.Encode()
}

// VerifyTOTP reports the accepted time step so the caller can persist it and
// reject a replay of the same code. An unusable secret rejects every code:
// deriving no code must never be mistaken for deriving an empty one, which
// would match an empty submitted code.
func VerifyTOTP(secret, code string, now time.Time) (int64, bool) {
	key, err := totpEncoding.DecodeString(secret)
	if err != nil || len(key) == 0 || len(code) != totpDigits {
		return 0, false
	}
	step := now.Unix() / 30
	for offset := int64(-totpSkew); offset <= totpSkew; offset++ {
		candidateStep := step + offset
		if hmac.Equal([]byte(totpCode(key, candidateStep)), []byte(code)) {
			return candidateStep, true
		}
	}
	return 0, false
}

func totpCode(key []byte, step int64) string {
	message := make([]byte, 8)
	binary.BigEndian.PutUint64(message, uint64(step))
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(message)
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 0x0f
	value := binary.BigEndian.Uint32(digest[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", totpDigits, value%1_000_000)
}

func NewRecoveryCodes() ([]string, [][]byte, error) {
	codes := make([]string, 10)
	hashes := make([][]byte, 10)
	for index := range codes {
		random := make([]byte, 10)
		if _, err := rand.Read(random); err != nil {
			return nil, nil, fmt.Errorf("generate recovery code: %w", err)
		}
		raw := strings.ToUpper(hex.EncodeToString(random))
		codes[index] = raw[:5] + "-" + raw[5:10] + "-" + raw[10:15] +
			"-" + raw[15:]
		hash := sha256.Sum256([]byte(codes[index]))
		hashes[index] = hash[:]
	}
	return codes, hashes, nil
}

func RecoveryCodeHash(code string) []byte {
	normalized := strings.ToUpper(strings.TrimSpace(code))
	digest := sha256.Sum256([]byte(normalized))
	return digest[:]
}
