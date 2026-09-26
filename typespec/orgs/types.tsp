import "../common/domain.tsp";

namespace Vetchium.Orgs;

/** Canonical BCP 47 locales with complete Org portal translations. */
enum FrontendLocale {
  EnglishUnitedStates: "en-US",
  Tamil: "ta",
  German: "de-DE",
}

/** A stable, location-neutral Org DID encoded as UUIDv7. It stays inside the
 * backend and the private mesh; browser APIs identify an Org by its domain. */
@format("uuid")
scalar OrgDID extends string;

/**
 * An exact domain an Org claims. It follows the shared domain syntax and its
 * last label must contain a letter, so a numeric name cannot be claimed.
 */
@minLength(3)
@maxLength(253)
@pattern("^[A-Za-z0-9.-]+$")
scalar OrgDomain extends string;
