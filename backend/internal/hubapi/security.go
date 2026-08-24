package hubapi

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	coordinatorspec "github.com/vetchium/src/typespec/global-coordinator"
	"github.com/vetchium/src/typespec/hub"

	"backend/internal/adminapi"
)

func DeriveCredentialKey(tenantID, deploymentSecret string) [32]byte {
	return sha256.Sum256([]byte(
		"vetchium-hub-credentials\x00" + tenantID + "\x00" +
			deploymentSecret,
	))
}

func DeriveCredentialSubkey(root [32]byte, purpose string) [32]byte {
	mac := hmac.New(sha256.New, root[:])
	_, _ = mac.Write([]byte("vetchium-hub-subkey\x00" + purpose))
	var result [32]byte
	copy(result[:], mac.Sum(nil))
	return result
}

func NewUUIDv7(now time.Time) (pgtype.UUID, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return pgtype.UUID{}, fmt.Errorf("generate UUIDv7 randomness: %w", err)
	}
	milliseconds := now.UTC().UnixMilli()
	if milliseconds < 0 || milliseconds > (1<<48)-1 {
		return pgtype.UUID{}, fmt.Errorf("UUIDv7 timestamp is out of range")
	}
	value[0] = byte(milliseconds >> 40)
	value[1] = byte(milliseconds >> 32)
	value[2] = byte(milliseconds >> 24)
	value[3] = byte(milliseconds >> 16)
	value[4] = byte(milliseconds >> 8)
	value[5] = byte(milliseconds)
	value[6] = (value[6] & 0x0f) | 0x70
	value[8] = (value[8] & 0x3f) | 0x80
	return pgtype.UUID{Bytes: value, Valid: true}, nil
}

func NewUUID() (pgtype.UUID, error) {
	return adminapi.NewUUID()
}

func Handle(
	displayName string, shortID coordinatorspec.ShortID,
) hub.HubHandle {
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
	return hub.HubHandle(string(prefix) + "-" + string(shortID))
}

func NewToken() (string, []byte, error) {
	return adminapi.NewToken()
}

func TokenHash(token string) []byte {
	return adminapi.TokenHash(token)
}

func Encrypt(key [32]byte, plaintext []byte) ([]byte, error) {
	return adminapi.Encrypt(key, plaintext)
}

func Decrypt(key [32]byte, ciphertext []byte) ([]byte, error) {
	return adminapi.Decrypt(key, ciphertext)
}

func HashPassword(password string) (string, error) {
	return adminapi.HashPassword(password)
}

func ComparePassword(hash, password string) error {
	return adminapi.ComparePassword(hash, password)
}

func CompareUnknownPassword(password string) {
	adminapi.CompareUnknownPassword(password)
}

func NewTOTPSecret() (string, error) {
	return adminapi.NewTOTPSecret()
}

func TOTPProvisioningURI(email, issuer, secret string) string {
	return adminapi.TOTPProvisioningURI(email, issuer, secret)
}

func VerifyTOTP(secret, code string, now time.Time) (int64, bool) {
	return adminapi.VerifyTOTP(secret, code, now)
}

func NewRecoveryCodes() ([]string, [][]byte, error) {
	return adminapi.NewRecoveryCodes()
}

func RecoveryCodeHash(code string) []byte {
	return adminapi.RecoveryCodeHash(code)
}

func FormatUUID(value pgtype.UUID) string {
	return adminapi.FormatUUID(value)
}

func Int64(value int64) pgtype.Int8 {
	return adminapi.Int64(value)
}

func Timestamp(value time.Time) pgtype.Timestamptz {
	return adminapi.Timestamp(value)
}

func Text(value string) pgtype.Text {
	return pgtype.Text{String: value, Valid: true}
}
