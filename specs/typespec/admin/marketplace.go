package admin

// Admin marketplace types are defined in vetchium-api-server.typespec/org.
// Admin marketplace handlers import from that package directly using:
//
//	import orgspec "vetchium-api-server.typespec/org"
//
// The types used by admin marketplace routes are:
//   orgspec.AdminCreateCapabilityRequest, orgspec.AdminUpdateCapabilityRequest
//   orgspec.AdminListListingsRequest, orgspec.AdminListListingsResponse
//   orgspec.AdminSuspendListingRequest, orgspec.AdminReinstateListingRequest
//   orgspec.AdminListSubscriptionsRequest, orgspec.AdminListSubscriptionsResponse
//   orgspec.AdminCancelSubscriptionRequest
//   orgspec.MarketplaceListing, orgspec.MarketplaceCapability, orgspec.MarketplaceSubscription
