namespace Vetchium;

/** Languages supported throughout Vetchium portals. */
enum LanguageCode {
  EnglishUnitedStates: "en-US",
  GermanGermany: "de-DE",
  TamilIndia: "ta-IN",
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

/**
 * An IANA Time Zone Database canonical identifier, such as Asia/Kolkata.
 * Abbreviations, fixed offsets, unknown identifiers, and deprecated aliases
 * are not accepted.
 */
@minLength(1)
@maxLength(255)
@format("iana-time-zone")
scalar TimeZoneID extends string;

/** A non-empty, Unicode display name after surrounding whitespace is removed. */
@minLength(1)
@maxLength(200)
scalar DisplayName extends string;

/** One localized-script or transliterated variant of a display name. */
model LocalizedDisplayName {
  language_code: RegionalLanguageCode;
  display_name: DisplayName;
}
