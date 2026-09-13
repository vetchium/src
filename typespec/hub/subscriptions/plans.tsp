import "@typespec/openapi";

namespace Vetchium.Hub;

/** Hub plans this contract version defines. */
enum HubPlan {
  FreeTier: "hub-free-tier",
  SilverTier: "hub-silver-tier",
}

/**
 * An extensible plan OID returned to clients. A portal older than its API shows
 * an OID it does not recognize as the raw value.
 *
 * `x-vetchium-plan-ranks` gives each defined plan its unique rank. A higher
 * rank includes everything a lower rank allows.
 */
@format("vetchium-hub-plan-oid")
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["hub-free-tier", "hub-silver-tier"]
)
@TypeSpec.OpenAPI.extension(
  "x-vetchium-plan-ranks",
  #{ `hub-free-tier`: 1000, `hub-silver-tier`: 2000 }
)
scalar HubPlanOID extends string;

enum BillingInterval {
  Month: "month",
  Year: "year",
}
