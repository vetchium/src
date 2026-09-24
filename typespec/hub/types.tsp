namespace Vetchium.Hub;

/** Canonical BCP 47 locales with complete Hub portal translations. */
enum FrontendLocale {
  EnglishUnitedStates: "en-US",
  Tamil: "ta",
  German: "de-DE",
}

/** A stable, location-neutral Hub user DID encoded as UUIDv7. It stays inside
 * the backend and the private mesh; browser APIs identify a Hub user by
 * handle. */
@format("uuid")
scalar HubUserDID extends string;

/** A fixed-width public Hub handle with a readable display-name prefix. */
@minLength(17)
@maxLength(17)
@pattern("^[a-z0-9]{5}-[0-9a-hjkmnp-tv-z]{11}$")
scalar HubHandle extends string;
