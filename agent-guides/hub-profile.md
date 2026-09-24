# Hub Profile

Applies to Hub profile storage, editing, viewing, professional-email evidence,
work and education claims, languages, certifications, pictures, profile URLs,
and aliases.

## Required product specification

Read the accepted specification before designing or changing profile work:

- [`../docs/hub-profile.md`](../docs/hub-profile.md) is the normative product
  contract and the implementation-resume ledger.

Do not infer profile visibility, verification meaning, paid retention, or
cross-tenant ownership from an existing table or UI. The specifications decide
those rules.

## Implementation boundaries

- Compose this guide with `federation.md` for global handles, aliases, remote
  profile reads, and cross-tenant commands; with `object-storage.md` for profile
  pictures; and with `hub-subscriptions.md` for Silver entitlements and
  downgrade behavior.
- A professional-address message is permitted only for a verification code the
  user explicitly requested for that address. The annual verification reminder
  is UI-only: do not email the account address or professional address.
- Professional-email evidence is private account data in this version. Do not
  add it to another Hub user's profile response or a federated profile payload.
- The owner's profile editor holds only what other users see (PROF-GEN-005).
  Private account data (the sign-in email, language and job-search
  preferences, and professional-email evidence) belongs on settings pages,
  never on the profile page.
- Employer and institution values are normalized domains, not Org foreign keys.
  Future Org display metadata does not change ownership. Never load favicons or
  other third-party images for these domains: hub-ui's CSP `img-src` allows
  only `'self'`, `data:`, and tenant media origins, and profile domains are
  user-chosen.
- Validate language-only tags against `typespec/hub/profile/language_catalog.json`,
  generated from pinned living ISO 639-3 entries that have CLDR English display
  names. The catalog includes represented sign languages and deliberately omits
  variants, historical and constructed languages. Use CLDR locale fallback for
  display when a translated name is unavailable; do not accept a tag merely
  because it matches the two- or three-letter shape.
- Treat all user-entered professional claims as plain text and unverified unless
  a contract explicitly gives Vetchium a verification role.
