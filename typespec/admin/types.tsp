namespace Vetchium.Admin;

/** Canonical BCP 47 locales with complete Admin portal translations. */
enum FrontendLocale {
  EnglishUnitedStates: "en-US",
  Tamil: "ta",
  German: "de-DE",
}

/** An immutable admin-user identifier. */
@format("uuid")
scalar AdminUserID extends string;

@format("uuid")
scalar HubSignupDomainID extends string;
