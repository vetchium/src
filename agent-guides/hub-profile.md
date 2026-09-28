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
- A verified professional email is unique across every tenant (GU-PEM,
  `docs/global-uniqueness.md`): the coordinator holds only a keyed digest of
  the address, never the address itself (`identitydigest.Key.HubProfessionalEmail`),
  and the newest proof of control always wins, even across tenants. A local
  row's true verification status is `last_verified_at IS NOT NULL AND
  superseded_at IS NULL` — never read `last_verified_at` alone. Verifying a
  code no longer sets those columns directly; it creates a durable
  `federation_operations` claim that `backend/internal/hub/professionalemail`
  drives through the coordinator, mirroring `emailchange`'s Start/Advance
  shape and its own local digest interface (GU-KEY-002). Two workers keep a
  tenant's rows honest against the coordinator: one applies the coordinator's
  per-tenant supersession feed as it arrives, the other periodically
  reconciles every locally-verified row against the coordinator's holdings
  check. Read `docs/hub-profile.md` PROF-WEM-014..016 for the product rules
  this implements, and `docs/global-uniqueness.md` §3.6 for the design.
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
