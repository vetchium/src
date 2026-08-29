package adminapi

import "backend/internal/credentials"

// credentialDomain separates admin keys from every other portal's keys derived
// from the same deployment secret.
const credentialDomain = "vetchium-admin"

func DeriveCredentialKey(tenantID, deploymentSecret string) [32]byte {
	return credentials.DeriveKey(
		credentialDomain+"-credentials", tenantID, deploymentSecret,
	)
}

func DeriveCredentialSubkey(root [32]byte, purpose string) [32]byte {
	return credentials.DeriveSubkey(credentialDomain+"-subkey", root, purpose)
}
