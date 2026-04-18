package orgtiers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
)

// QuotaKey identifies which resource cap to check.
type QuotaKey string

const (
	QuotaOrgUsers            QuotaKey = "org_users"
	QuotaDomainsVerified     QuotaKey = "domains_verified"
	QuotaSubOrgs             QuotaKey = "suborgs"
	QuotaMarketplaceListings QuotaKey = "marketplace_listings"
)

// ErrQuotaExceeded is returned when an org has hit its tier cap.
var ErrQuotaExceeded = errors.New("quota exceeded")

// QuotaExceededPayload is the JSON body returned to the caller when quota is exceeded.
type QuotaExceededPayload struct {
	Quota      QuotaKey `json:"quota"`
	CurrentCap int32    `json:"current_cap"`
	TierID     string   `json:"tier_id"`
}

// capFor returns the cap for the given key from a subscription row, and -1 for unlimited.
func capFor(key QuotaKey, sub globaldb.GetOrgSubscriptionRow) int32 {
	switch key {
	case QuotaOrgUsers:
		if sub.OrgUsersCap.Valid {
			return sub.OrgUsersCap.Int32
		}
	case QuotaDomainsVerified:
		if sub.DomainsVerifiedCap.Valid {
			return sub.DomainsVerifiedCap.Int32
		}
	case QuotaSubOrgs:
		if sub.SuborgsCap.Valid {
			return sub.SuborgsCap.Int32
		}
	case QuotaMarketplaceListings:
		if sub.MarketplaceListingsCap.Valid {
			return sub.MarketplaceListingsCap.Int32
		}
	}
	return -1 // unlimited
}

// EnforceQuota checks whether the org is within its tier cap for the given quota key.
// It calls the appropriate count query and compares to the cap.
// On ErrQuotaExceeded, callers should write a 403 with WriteQuotaError.
//
// For QuotaOrgUsers and QuotaDomainsVerified the count comes from the global DB.
// For QuotaSubOrgs and QuotaMarketplaceListings the count comes from the regional DB.
func EnforceQuota(
	ctx context.Context,
	key QuotaKey,
	orgID pgtype.UUID,
	global *globaldb.Queries,
	regional *regionaldb.Queries,
) (*QuotaExceededPayload, error) {
	sub, err := global.GetOrgSubscription(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("orgtiers: get subscription: %w", err)
	}

	cap := capFor(key, sub)
	if cap < 0 {
		return nil, nil // unlimited
	}

	var count int32
	switch key {
	case QuotaOrgUsers:
		count, err = global.CountOrgUsers(ctx, orgID)
	case QuotaDomainsVerified:
		count, err = regional.CountVerifiedDomainsForOrg(ctx, orgID)
	case QuotaSubOrgs:
		count, err = regional.CountSubOrgsForOrg(ctx, orgID)
	case QuotaMarketplaceListings:
		// Phase 2 will add CountActiveOrPendingListingsForOrg; return nil for now.
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("orgtiers: count %s: %w", key, err)
	}

	if count >= cap {
		return &QuotaExceededPayload{
			Quota:      key,
			CurrentCap: cap,
			TierID:     sub.CurrentTierID,
		}, ErrQuotaExceeded
	}
	return nil, nil
}

// WriteQuotaError writes a 403 response with the quota payload.
func WriteQuotaError(w http.ResponseWriter, payload *QuotaExceededPayload) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	json.NewEncoder(w).Encode(payload)
}
