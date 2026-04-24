package org

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	orgspec "vetchium-api-server.typespec/org"
)

// ErrSelfSubscription is returned when an org tries to subscribe to its own listing.
var ErrSelfSubscription = errors.New("cannot subscribe to own listing")

// validateCapabilityIDs checks that all given capability IDs exist and are active.
func validateCapabilityIDs(
	ctx context.Context,
	global *globaldb.Queries,
	capIDs []string,
) error {
	for _, cid := range capIDs {
		count, err := global.CapabilityExists(ctx, cid)
		if err != nil {
			return fmt.Errorf("validateCapabilityIDs: %w", err)
		}
		if count == 0 {
			return fmt.Errorf("capability %q not found or not active", cid)
		}
	}
	return nil
}

// writeCapabilityError writes a 422 for invalid capability_id.
func writeCapabilityError(w http.ResponseWriter, capID string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnprocessableEntity)
	msg, _ := json.Marshal(map[string]string{"message": fmt.Sprintf("capability %q not found or not active", capID)})
	w.Write(msg) //nolint:errcheck
}

// buildSubscription converts a regionaldb subscription row to the API model.
func buildSubscription(sub regionaldb.MarketplaceSubscription) orgspec.MarketplaceSubscription {
	result := orgspec.MarketplaceSubscription{
		SubscriptionID:        uuidToString(sub.SubscriptionID),
		ListingID:             uuidToString(sub.ListingID),
		ProviderOrgDomain:     sub.ProviderOrgDomain,
		ProviderListingNumber: sub.ProviderListingNumber,
		ConsumerOrgDomain:     sub.ConsumerOrgDomain,
		RequestNote:           sub.RequestNote,
		Status:                orgspec.MarketplaceSubscriptionStatus(sub.Status),
		StartedAt:             sub.StartedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		CreatedAt:             sub.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:             sub.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
	}
	if sub.ExpiresAt.Valid {
		t := sub.ExpiresAt.Time.Format("2006-01-02T15:04:05Z07:00")
		result.ExpiresAt = &t
	}
	if sub.CancelledAt.Valid {
		t := sub.CancelledAt.Time.Format("2006-01-02T15:04:05Z07:00")
		result.CancelledAt = &t
	}
	return result
}
