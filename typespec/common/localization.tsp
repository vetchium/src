namespace Vetchium;

/** Canonical BCP 47 locales with complete Vetchium interface translations. */
enum FrontendLocale {
  EnglishUnitedStates: "en-US",
  Tamil: "ta",
  German: "de-DE",
}

/** An assigned uppercase ISO 3166-1 alpha-2 country code. */
@pattern("^[A-Z]{2}$", "Must be an uppercase ISO 3166-1 alpha-2 code")
scalar CountryCode extends string;

/** A non-empty, Unicode display name after surrounding whitespace is removed. */
@minLength(1)
@maxLength(200)
scalar DisplayName extends string;
