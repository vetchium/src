package adminapi

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"golang.org/x/crypto/bcrypt"
)

const passwordHashPrefix = "v1$"

const credentialCipherVersion byte = 1

var legacyTimingHash = []byte(
	"$2a$10$r43DzlK2Kl9W9kvE6DfAkegUKSJd0g7ZiuOFi3Ozzcem5V83lLsUC",
)

func DeriveCredentialKey(tenantID, deploymentSecret string) [32]byte {
	return sha256.Sum256([]byte(
		"vetchium-admin-credentials\x00" + tenantID + "\x00" +
			deploymentSecret,
	))
}

func DeriveCredentialSubkey(root [32]byte, purpose string) [32]byte {
	mac := hmac.New(sha256.New, root[:])
	_, _ = mac.Write([]byte("vetchium-admin-subkey\x00" + purpose))
	var result [32]byte
	copy(result[:], mac.Sum(nil))
	return result
}

func NewToken() (string, []byte, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", nil, fmt.Errorf("generate token: %w", err)
	}
	token := hex.EncodeToString(secret)
	digest := sha256.Sum256([]byte(token))
	return token, digest[:], nil
}

func TokenHash(token string) []byte {
	digest := sha256.Sum256([]byte(token))
	return digest[:]
}

func NewUUID() (pgtype.UUID, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return pgtype.UUID{}, fmt.Errorf("generate UUID: %w", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return pgtype.UUID{Bytes: value, Valid: true}, nil
}

func Encrypt(key [32]byte, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("create encryption cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create encryption mode: %w", err)
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generate encryption nonce: %w", err)
	}
	ciphertext := []byte{credentialCipherVersion}
	ciphertext = append(ciphertext, nonce...)
	return aead.Seal(ciphertext, nonce, plaintext, nil), nil
}

func Decrypt(key [32]byte, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("create decryption cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create decryption mode: %w", err)
	}
	if len(ciphertext) < 1+aead.NonceSize() {
		return nil, fmt.Errorf("ciphertext is truncated")
	}
	if ciphertext[0] != credentialCipherVersion {
		return nil, fmt.Errorf("unsupported ciphertext version %d", ciphertext[0])
	}
	nonce := ciphertext[1 : 1+aead.NonceSize()]
	plaintext, err := aead.Open(
		nil, nonce, ciphertext[1+aead.NonceSize():], nil,
	)
	if err != nil {
		return nil, fmt.Errorf("decrypt ciphertext: %w", err)
	}
	return plaintext, nil
}

func HashPassword(password string) (string, error) {
	digest := sha512.Sum512_256([]byte(password))
	hash, err := bcrypt.GenerateFromPassword(
		[]byte(base64.RawStdEncoding.EncodeToString(digest[:])),
		bcrypt.DefaultCost,
	)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return passwordHashPrefix + string(hash), nil
}

func ComparePassword(hash, password string) error {
	if strings.HasPrefix(hash, passwordHashPrefix) {
		digest := sha512.Sum512_256([]byte(password))
		return bcrypt.CompareHashAndPassword(
			[]byte(strings.TrimPrefix(hash, passwordHashPrefix)),
			[]byte(base64.RawStdEncoding.EncodeToString(digest[:])),
		)
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

func CompareUnknownPassword(password string) {
	_ = bcrypt.CompareHashAndPassword(legacyTimingHash, []byte(password))
}

func NewTOTPSecret() (string, error) {
	secret := make([]byte, 20)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate TOTP secret: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).
		EncodeToString(secret), nil
}

func TOTPProvisioningURI(email, issuer, secret string) string {
	label := url.PathEscape(issuer + ":" + email)
	query := url.Values{
		"secret":    []string{secret},
		"issuer":    []string{issuer},
		"algorithm": []string{"SHA1"},
		"digits":    []string{"6"},
		"period":    []string{"30"},
	}
	return "otpauth://totp/" + label + "?" + query.Encode()
}

func VerifyTOTP(secret, code string, now time.Time) (int64, bool) {
	step := now.Unix() / 30
	for offset := int64(-1); offset <= 1; offset++ {
		candidateStep := step + offset
		if hmac.Equal(
			[]byte(totpCode(secret, candidateStep)), []byte(code),
		) {
			return candidateStep, true
		}
	}
	return 0, false
}

func totpCode(secret string, step int64) string {
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).
		DecodeString(secret)
	if err != nil {
		return ""
	}
	message := make([]byte, 8)
	binary.BigEndian.PutUint64(message, uint64(step))
	mac := hmac.New(sha1.New, decoded)
	_, _ = mac.Write(message)
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 0x0f
	value := binary.BigEndian.Uint32(digest[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1_000_000)
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

func CanonicalDigest(value []byte) [32]byte {
	return sha256.Sum256(value)
}

func SignValue(key [32]byte, purpose string, payload []byte) string {
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, key[:])
	_, _ = mac.Write([]byte(purpose))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(encoded))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return encoded + "." + signature
}

func VerifySignedValue(
	key [32]byte, purpose, value string,
) ([]byte, bool) {
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return nil, false
	}
	want := SignValue(key, purpose, mustDecodeBase64(parts[0]))
	if !hmac.Equal([]byte(want), []byte(value)) {
		return nil, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	return payload, err == nil
}

func mustDecodeBase64(value string) []byte {
	decoded, _ := base64.RawURLEncoding.DecodeString(value)
	return decoded
}

func RecoveryCodeHash(code string) []byte {
	normalized := strings.ToUpper(strings.TrimSpace(code))
	digest := sha256.Sum256([]byte(normalized))
	return digest[:]
}

func FormatUUID(value pgtype.UUID) string {
	if !value.Valid {
		return ""
	}
	return value.String()
}

func ParseUUID(value string) (pgtype.UUID, error) {
	var result pgtype.UUID
	err := result.Scan(value)
	if err != nil || !result.Valid {
		return pgtype.UUID{}, fmt.Errorf("parse UUID %q", value)
	}
	return result, nil
}

func Int64(value int64) pgtype.Int8 {
	return pgtype.Int8{Int64: value, Valid: true}
}

func Timestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value.UTC(), Valid: true}
}

func Text(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}

func Bool(value *bool) pgtype.Bool {
	if value == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *value, Valid: true}
}

func ParseInt64(value string) (int64, error) {
	return strconv.ParseInt(value, 10, 64)
}
