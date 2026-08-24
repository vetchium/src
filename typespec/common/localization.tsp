namespace Vetchium;

/** Locales with translated user-interface strings in Vetchium portals. */
enum FrontendLocale {
  EnglishUnitedStates: "en-US",
  Tamil: "ta",
  German: "de-DE",
}

/** An uppercase ISO 3166-1 alpha-3 country code. */
@pattern("^[A-Z]{3}$", "Must be an uppercase ISO 3166-1 alpha-3 code")
scalar CountryCode extends string;

/** A non-empty, Unicode display name after surrounding whitespace is removed. */
@minLength(1)
@maxLength(200)
scalar DisplayName extends string;
