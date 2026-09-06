package regions

import "github.com/vetchium/src/typespec/problem"

// RegionDiscoveryUnavailableError separates a failed lookup from a malformed
// request. A cursor issued by the live directory cannot be read by the bundled
// catalog, so reporting an invalid pagination key during an outage would blame
// the caller for a fault on the server side.
var RegionDiscoveryUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/region-discovery-unavailable",
	Title:  "Region discovery unavailable",
	Status: 503,
	Detail: "Region discovery is temporarily unavailable. Start again from the first page.",
}
