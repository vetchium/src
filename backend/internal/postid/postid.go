// Package postid mints and validates post and reply IDs (PST-ID-001).
// The leading XID part keeps B-tree inserts near the end of the index. The
// random tail makes an ID impossible to guess. The XID time is not a
// creation time: never use it as created_at (PST-ID-004).
package postid

import (
	"crypto/rand"
	"fmt"
	"regexp"
	"strings"

	"github.com/rs/xid"
)

// Length is the number of characters in a post or reply ID.
const Length = 40

const (
	alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	tailLen  = Length - 20
	// limit is 7 * 36: bytes at or above it are discarded so that b % 36 is
	// unbiased.
	limit = 252
)

var validID = regexp.MustCompile(`^[0-9a-v]{20}[0-9a-z]{20}$`)

// New returns a new ID: a 20-character XID and 20 random characters.
func New() (string, error) {
	var sb strings.Builder
	sb.Grow(Length)
	sb.WriteString(xid.New().String())

	buf := make([]byte, 32)
	for n := 0; n < tailLen; {
		if _, err := rand.Read(buf); err != nil {
			return "", fmt.Errorf("read random bytes: %w", err)
		}
		for _, b := range buf {
			if b >= limit {
				continue
			}
			sb.WriteByte(alphabet[b%36])
			n++
			if n == tailLen {
				break
			}
		}
	}
	return sb.String(), nil
}

// Valid reports whether id has the post ID shape.
func Valid(id string) bool {
	return validID.MatchString(id)
}
