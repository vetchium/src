package org

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

// ErrSelfSubscription is returned when an org tries to subscribe to its own listing.
var ErrSelfSubscription = errors.New("cannot subscribe to own listing")

// buildListingFromRow converts a regionaldb row + capabilities to the API model.
func buildListingFromRow(
	ctx context.Context,
	listing regionaldb.MarketplaceListing,
	capabilities []string,
	activeSubCount int32,
	isSubscribed bool,
) orgspec.MarketplaceListing {
	result := orgspec.MarketplaceListing{
		ListingID:             uuidToString(listing.ListingID),
		OrgDomain:             listing.OrgDomain,
		ListingNumber:         listing.ListingNumber,
		Headline:              listing.Headline,
		Description:           listing.Description,
		Capabilities:          capabilities,
		Status:                orgspec.MarketplaceListingStatus(listing.Status),
		ActiveSubscriberCount: activeSubCount,
		CreatedAt:             listing.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:             listing.UpdatedAt.Time.Format(time.RFC3339),
		IsSubscribed:          isSubscribed,
	}
	if listing.SuspensionNote.Valid {
		result.SuspensionNote = &listing.SuspensionNote.String
	}
	if listing.RejectionNote.Valid {
		result.RejectionNote = &listing.RejectionNote.String
	}
	if listing.ListedAt.Valid {
		t := listing.ListedAt.Time.Format(time.RFC3339)
		result.ListedAt = &t
	}
	return result
}

// fetchListingCapabilities returns active capability IDs for a listing.
func fetchListingCapabilities(
	ctx context.Context,
	regional *regionaldb.Queries,
	listingID pgtype.UUID,
) ([]string, error) {
	rows, err := regional.ListCurrentCapabilitiesForListing(ctx, listingID)
	if err != nil {
		return nil, fmt.Errorf("fetchListingCapabilities: %w", err)
	}
	caps := make([]string, 0, len(rows))
	for _, r := range rows {
		caps = append(caps, r)
	}
	return caps, nil
}

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
		StartedAt:             sub.StartedAt.Time.Format(time.RFC3339),
		CreatedAt:             sub.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:             sub.UpdatedAt.Time.Format(time.RFC3339),
	}
	if sub.ExpiresAt.Valid {
		t := sub.ExpiresAt.Time.Format(time.RFC3339)
		result.ExpiresAt = &t
	}
	if sub.CancelledAt.Valid {
		t := sub.CancelledAt.Time.Format(time.RFC3339)
		result.CancelledAt = &t
	}
	return result
}

// upsertGlobalSubscriptionIndex writes the subscription summary to the global DB.
// On failure, logs a CONSISTENCY_ALERT but doesn't fail the request.
func upsertGlobalSubscriptionIndex(
	ctx context.Context,
	s *server.RegionalServer,
	sub regionaldb.MarketplaceSubscription,
	consumerRegion globaldb.Region,
	providerOrgID pgtype.UUID,
	providerRegion globaldb.Region,
) {
	err := s.Global.UpsertSubscriptionIndex(ctx, globaldb.UpsertSubscriptionIndexParams{
		SubscriptionID: sub.SubscriptionID,
		ListingID:      sub.ListingID,
		ConsumerOrgID:  sub.ConsumerOrgID,
		ConsumerRegion: string(consumerRegion),
		ProviderOrgID:  providerOrgID,
		ProviderRegion: string(providerRegion),
		Status:         string(sub.Status),
	})
	if err != nil {
		s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to upsert subscription index", "error", err, "subscription_id", uuidToString(sub.SubscriptionID))
	}
}

// getProviderOrgByDomain looks up the provider org by domain.
func getProviderOrgByDomain(
	ctx context.Context,
	global *globaldb.Queries,
	domain string,
) (globaldb.Org, error) {
	return global.GetOrgByDomain(ctx, domain)
}

// isListingErrNoRows checks whether a pgx error is a "not found" error.
func isListingErrNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
