# Hub Profile

Applies to Hub profile storage, editing, viewing, professional-email evidence,
work and education claims, languages, certifications, websites, pictures,
profile URLs, and aliases.

## Required product specification

[`../docs/hub-profile.md`](../docs/hub-profile.md) is the normative product
contract and the implementation-resume ledger. Read it before designing or
changing profile work. Do not infer profile visibility, verification meaning,
paid retention, or cross-tenant ownership from an existing table or UI.

## Implementation boundaries

- Compose with [`federation.md`](federation.md) (global handles, aliases, remote
  profile reads, cross-tenant commands), [`object-storage.md`](object-storage.md)
  (pictures), and [`hub-subscriptions.md`](hub-subscriptions.md) (Silver
  entitlements, downgrade behavior).
- Seed profile fixtures under `dev/hub-seed-profiles/` never point at a real
  person's account or credential. Website and credential URLs use a reserved
  `example.com` or `example.dev` host, such as
  `https://github.example.com/priya-ramachandran-example`, because dev-seed
  output and logs would otherwise expose them.
- A professional-address message is permitted only for a verification code the
  user explicitly requested for that address. The annual verification reminder is
  UI-only: never email the account or professional address.
- Professional-email evidence is private account data in this version; never add
  it to another Hub user's profile response or a federated profile payload.
- The owner's profile editor holds only what other users see (PROF-GEN-005).
  Private account data (sign-in email, language and job-search preferences,
  professional-email evidence) belongs on settings pages, never the profile page.
- Employer and institution values are normalized domains, not Org foreign keys;
  future Org display metadata does not change ownership. Never load favicons or
  other third-party images for these domains: hub-ui's CSP `img-src` allows only
  `'self'`, `data:`, and tenant media origins, and profile domains are
  user-chosen.
- Validate language-only tags against
  `typespec/hub/profile/language_catalog.json`, generated from pinned living ISO
  639-3 entries that have CLDR English display names. It includes represented
  sign languages and deliberately omits variants, historical, and constructed
  languages. Use CLDR locale fallback for display when a translated name is
  unavailable. Never accept a tag merely because it matches the two- or
  three-letter shape.
- Treat user-entered professional claims as plain text and unverified unless a
  contract explicitly gives Vetchium a verification role.
- Websites are public profile fields whose stored value is the normalized URL and
  nothing else (PROF-WEB-*). The GitHub, LinkedIn, X, etc. kind is client-side
  presentation derived from the exact host, never stored, sent, or used to grant
  trust. Link only a value passing the shared validator (a peer tenant's payload
  is not trusted to be a safe `href`), render it with `rel="noopener noreferrer"`,
  and use local icons, never an image from the linked host. URL normalization and
  the check exist in Go, TypeScript, and the `hub_websites_url_check` constraint;
  change them together.
