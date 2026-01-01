package tokens

import (
	"errors"
	"fmt"
	"strings"

	"vetchium-api-server.gomodule/internal/db/globaldb"
)

var (
	ErrInvalidTokenFormat = errors.New("invalid token format")
	ErrUnknownRegion      = errors.New("unknown region code in token")
	ErrMissingPrefix      = errors.New("token missing region prefix")
)

// AddRegionPrefix adds the region prefix to a token
// Input: region (ind1, usa1, deu1) + raw token (64 char hex)
// Output: prefixed token (e.g., "IND1-abc123...")
func AddRegionPrefix(region globaldb.Region, rawToken string) string {
	prefix := strings.ToUpper(string(region))
	return fmt.Sprintf("%s-%s", prefix, rawToken)
}

// ExtractRegionFromToken extracts the region and raw token from a prefixed token
// Input: prefixed token (e.g., "IND1-abc123...")
// Output: region (ind1) + raw token (abc123...), or error
func ExtractRegionFromToken(prefixedToken string) (globaldb.Region, string, error) {
	// Find the dash separator
	dashIndex := strings.Index(prefixedToken, "-")
	if dashIndex == -1 {
		return "", "", ErrMissingPrefix
	}

	// Extract prefix and raw token
	prefix := prefixedToken[:dashIndex]
	rawToken := prefixedToken[dashIndex+1:]

	// Convert prefix to lowercase region code
	regionCode := strings.ToLower(prefix)

	// Validate region code
	var region globaldb.Region
	switch regionCode {
	case "ind1":
		region = globaldb.RegionInd1
	case "usa1":
		region = globaldb.RegionUsa1
	case "deu1":
		region = globaldb.RegionDeu1
	default:
		return "", "", fmt.Errorf("%w: %s", ErrUnknownRegion, prefix)
	}

	// Validate raw token format (64 char hex)
	if len(rawToken) != 64 {
		return "", "", fmt.Errorf("%w: expected 64 character hex string, got %d", ErrInvalidTokenFormat, len(rawToken))
	}

	// Simple hex validation (all chars are 0-9, a-f)
	for _, ch := range rawToken {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) {
			return "", "", fmt.Errorf("%w: token contains non-hex characters", ErrInvalidTokenFormat)
		}
	}

	return region, rawToken, nil
}
