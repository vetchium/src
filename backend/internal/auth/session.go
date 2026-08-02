package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
)

const (
	sessionTokenBytes = 32

	AdminBearerRealm = "vetchium-admin"
)

func NewSessionToken() (string, []byte, error) {
	random := make([]byte, sessionTokenBytes)
	if _, err := rand.Read(random); err != nil {
		return "", nil, fmt.Errorf("generate session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(random)
	return token, HashSessionToken(token), nil
}

func HashSessionToken(token string) []byte {
	hash := sha256.Sum256([]byte(token))
	return hash[:]
}

func BearerToken(authorization string) (string, bool) {
	parts := strings.Fields(authorization)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", false
	}
	return parts[1], true
}
