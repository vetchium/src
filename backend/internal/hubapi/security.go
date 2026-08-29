package hubapi

import (
	"strings"

	coordinatorspec "github.com/vetchium/src/typespec/global-coordinator"
	"github.com/vetchium/src/typespec/hub"

	"backend/internal/credentials"
)

// credentialDomain separates Hub keys from every other portal's keys derived
// from the same deployment secret.
const credentialDomain = "vetchium-hub"

func DeriveCredentialKey(tenantID, deploymentSecret string) [32]byte {
	return credentials.DeriveKey(
		credentialDomain+"-credentials", tenantID, deploymentSecret,
	)
}

func DeriveCredentialSubkey(root [32]byte, purpose string) [32]byte {
	return credentials.DeriveSubkey(credentialDomain+"-subkey", root, purpose)
}

// Handle builds the tenant-local handle for a new Hub User. The short ID keeps
// it unique; the display-name prefix keeps it recognizable.
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
