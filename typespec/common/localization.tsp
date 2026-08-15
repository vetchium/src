namespace Vetchium;

/** Locales with translated user-interface strings in Vetchium portals. */
enum FrontendLocale {
  EnglishUnitedStates: "en-US",
  Tamil: "ta",
  German: "de_DE",
}

/**
 * A registered language-region combination in canonical casing. Runtime
 * validation confirms that both subtags exist in the IANA registry.
 */
@pattern(
  "^[a-z]{2}-[A-Z]{2}$",
  "Must contain a two-letter language and region, such as en-US"
)
@format("bcp47-language-region")
scalar RegionalLanguageCode extends string;

/** A non-empty, Unicode display name after surrounding whitespace is removed. */
@minLength(1)
@maxLength(200)
scalar DisplayName extends string;

/** One localized-script or transliterated variant of a display name. */
model LocalizedDisplayName {
  language_code: RegionalLanguageCode;
  display_name: DisplayName;
}
