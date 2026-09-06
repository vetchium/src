package users

import (
	"strings"

	"github.com/vetchium/src/typespec/hub"
)

// Deriving the suffix from the full DID keeps signup independent of the global
// allocator and preserves the handle when the account moves.
func Handle(
	displayName string, did hub.HubUserDID,
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
	return hub.HubHandle(string(prefix) + "-" + strings.ReplaceAll(string(did), "-", ""))
}
