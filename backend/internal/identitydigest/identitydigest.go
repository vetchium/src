// Package identitydigest derives the keyed digests the global directory
// stores in place of Hub email addresses. The digest key is deliberately
// shared by every tenant (see appconfig.IdentityDigestSecret), never mounted
// into the global coordinator or mesh-api, so the coordinator can enforce
// global uniqueness without ever holding a reversible address.
package identitydigest

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// rootDomain separates this package's root key from every other purpose a
// deployment secret might be turned into, mirroring
// credentials.DeriveKey's domain separation. Unlike a portal credential key,
// this root key is not bound to a tenant id: every tenant must derive the
// identical key from the identical shared secret.
const rootDomain = "vetchium-identity-digest-root"

const digestPrefix = "vetchium/identity-digest/v1/"

const keyIDPurpose = "vetchium/identity-digest/key-id/v1"

// Namespace separates digests of the same address computed for different
// purposes, so the global directory can never correlate an account email with
// a professional email even when they are byte-identical addresses.
type Namespace string

const (
	NamespaceHubAccountEmail      Namespace = "hub-account-email"
	NamespaceHubProfessionalEmail Namespace = "hub-professional-email"
)

// Key is the shared HMAC key every tenant derives from the identity digest
// secret. It never leaves the hub-api and workers processes that hold the
// secret.
type Key struct {
	root [32]byte
}

// NewKey derives the digest key from the raw shared secret string.
func NewKey(secret string) Key {
	return Key{root: sha256.Sum256([]byte(rootDomain + "\x00" + secret))}
}

// HubAccountEmail returns the digest the global directory stores for a Hub
// account (sign-in) email address.
func (k Key) HubAccountEmail(address string) []byte {
	return k.digest(NamespaceHubAccountEmail, address)
}

// HubProfessionalEmail returns the digest the global directory stores for a
// verified professional (work) email address.
func (k Key) HubProfessionalEmail(address string) []byte {
	return k.digest(NamespaceHubProfessionalEmail, address)
}

func (k Key) digest(namespace Namespace, address string) []byte {
	mac := hmac.New(sha256.New, k.root[:])
	_, _ = mac.Write(
		[]byte(digestPrefix + string(namespace) + "\x00" + Normalize(address)),
	)
	return mac.Sum(nil)
}

// ID identifies which shared secret produced a digest, without revealing
// anything about any address it digested. Every directory request carrying a
// digest also carries this id, so the coordinator can reject a tenant
// misconfigured with a different secret instead of silently breaking global
// uniqueness.
func (k Key) ID() string {
	mac := hmac.New(sha256.New, k.root[:])
	_, _ = mac.Write([]byte(keyIDPurpose))
	sum := mac.Sum(nil)
	return hex.EncodeToString(sum[:8])
}

// Normalize matches the canonical form the database CHECK constraints
// enforce, lower(btrim(address)). PostgreSQL's btrim with no explicit
// character set strips only the ASCII space character, not every Unicode
// whitespace code point strings.TrimSpace would remove, so this deliberately
// trims a narrower set to stay byte-identical with the database.
func Normalize(address string) string {
	return strings.ToLower(strings.Trim(address, " "))
}
