// Package orgmail is the encrypted payload contract between the Org email
// producers (orgs-api and the domain re-verification job) and the worker
// that delivers the Org email outbox.
package orgmail

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"

	"backend/internal/credentials"
)

// Payload carries only what a message needs. A signup link or reset link is
// a credential, which is why the whole payload is encrypted at rest.
type Payload struct {
	Domain       string    `json:"domain"`
	RecordName   string    `json:"record_name,omitempty"`
	RecordValue  string    `json:"record_value,omitempty"`
	ActionURL    string    `json:"action_url,omitempty"`
	ExpiresAt    time.Time `json:"expires_at,omitzero"`
	ReleaseAfter time.Time `json:"release_after,omitzero"`
}

func Encrypt(key [32]byte, payload Payload) ([]byte, error) {
	plaintext, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode Org email payload: %w", err)
	}
	return credentials.Encrypt(key, plaintext)
}

func Decrypt(key [32]byte, ciphertext []byte) (Payload, error) {
	plaintext, err := credentials.Decrypt(key, ciphertext)
	if err != nil {
		return Payload{}, fmt.Errorf("decrypt Org email payload: %w", err)
	}
	var payload Payload
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return Payload{}, fmt.Errorf("decode Org email payload: %w", err)
	}
	return payload, nil
}
