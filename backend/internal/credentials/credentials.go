// Package credentials implements the secret handling shared by every portal.
// It is deliberately portal-agnostic: the caller supplies the domain string
// that separates one portal's derived keys from another's.
package credentials

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

const passwordHashPrefix = "v1$"

const cipherVersion byte = 1

var legacyTimingHash = []byte(
	"$2a$10$r43DzlK2Kl9W9kvE6DfAkegUKSJd0g7ZiuOFi3Ozzcem5V83lLsUC",
)

// DeriveKey binds a portal's root credential key to one tenant. The domain
// separates portals that share a deployment secret, so an admin key and a Hub
// key never collide even for the same tenant.
func DeriveKey(domain, tenantID, deploymentSecret string) [32]byte {
	return sha256.Sum256([]byte(
		domain + "\x00" + tenantID + "\x00" + deploymentSecret,
	))
}

// DeriveSubkey separates the uses of one root key, so a compromise of a
// purpose-specific key cannot be replayed against another purpose.
func DeriveSubkey(domain string, root [32]byte, purpose string) [32]byte {
	mac := hmac.New(sha256.New, root[:])
	_, _ = mac.Write([]byte(domain + "\x00" + purpose))
	var result [32]byte
	copy(result[:], mac.Sum(nil))
	return result
}

// NewToken returns an opaque bearer token and the hash persisted for it. The
// plaintext token is never stored.
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
	ciphertext := []byte{cipherVersion}
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
	if ciphertext[0] != cipherVersion {
		return nil, fmt.Errorf(
			"unsupported ciphertext version %d", ciphertext[0],
		)
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

// HashPassword pre-hashes with SHA-512/256 because bcrypt silently truncates
// its input at 72 bytes.
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

// CompareUnknownPassword spends the same time a real comparison would, so a
// caller cannot distinguish an unknown account from a wrong password.
func CompareUnknownPassword(password string) {
	_ = bcrypt.CompareHashAndPassword(legacyTimingHash, []byte(password))
}

func CanonicalDigest(value []byte) [32]byte {
	return sha256.Sum256(value)
}

// SignValue authenticates an opaque value the client hands back later, such as
// a pagination key. The purpose prevents a value signed for one use from
// verifying for another.
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
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, false
	}
	want := SignValue(key, purpose, payload)
	if !hmac.Equal([]byte(want), []byte(value)) {
		return nil, false
	}
	return payload, true
}
