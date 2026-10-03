import "@typespec/openapi";

namespace Vetchium.Orgs;

/** Org plans this contract version defines. */
enum OrgPlan {
  FreeTier: "org-free-tier",
  SilverTier: "org-silver-tier",
  GoldTier: "org-gold-tier",
}

/**
 * An extensible plan OID returned to clients. A portal older than its API shows
 * an OID it does not recognize as the raw value.
 *
 * `x-vetchium-plan-ranks` gives each defined plan its unique rank. A higher
 * rank includes everything a lower rank allows.
 *
 * `x-vetchium-plan-entitlements` is the single authority for what a plan
 * allows. `max_users` is the seat cap; `max_users_with_google_sign_in` replaces
 * it while the Org has Google sign-in enabled, and `null` means unlimited.
 * `openings_per_year` counts openings published in the last 365 days.
 */
@format("vetchium-org-plan-oid")
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["org-free-tier", "org-silver-tier", "org-gold-tier"]
)
@TypeSpec.OpenAPI.extension(
  "x-vetchium-plan-ranks",
  #{ `org-free-tier`: 1000, `org-silver-tier`: 2000, `org-gold-tier`: 3000 }
)
@TypeSpec.OpenAPI.extension(
  "x-vetchium-plan-entitlements",
  #{
    `org-free-tier`: #{
      max_users: 5,
      max_users_with_google_sign_in: 5,
      openings_per_year: 25,
      allows_logo: false,
      allows_google_sign_in: false,
      includes_ticket_support: false,
    },
    `org-silver-tier`: #{
      max_users: 50,
      max_users_with_google_sign_in: 50,
      openings_per_year: 250,
      allows_logo: true,
      allows_google_sign_in: false,
      includes_ticket_support: false,
    },
    `org-gold-tier`: #{
      max_users: 1000,
      max_users_with_google_sign_in: null,
      openings_per_year: 2500,
      allows_logo: true,
      allows_google_sign_in: true,
      includes_ticket_support: true,
    },
  }
)
scalar OrgPlanOID extends string;

enum OrgBillingInterval {
  Month: "month",
  Year: "year",
}
