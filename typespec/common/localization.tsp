namespace Vetchium;

/** Locales with translated user-interface strings in Vetchium portals. */
enum FrontendLocale {
  EnglishUnitedStates: "en-US",
  Tamil: "ta",
  German: "de_DE",
}

/** A non-empty, Unicode display name after surrounding whitespace is removed. */
@minLength(1)
@maxLength(200)
scalar DisplayName extends string;
