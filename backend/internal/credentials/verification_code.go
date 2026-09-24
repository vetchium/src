package credentials

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"math/big"
)

// NewVerificationCode returns a uniformly random six-digit code for proving
// control of an email address.
func NewVerificationCode() (string, error) {
	number, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("generate verification code: %w", err)
	}
	return fmt.Sprintf("%06d", number.Int64()), nil
}

// VerificationCodeHash binds a code to the challenge that issued it, so a code
// sent for one challenge cannot satisfy another.
func VerificationCodeHash(key [32]byte, challengeID, code string) []byte {
	mac := hmac.New(sha256.New, key[:])
	_, _ = mac.Write([]byte(challengeID))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(code))
	return mac.Sum(nil)
}
