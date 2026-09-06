# Hub signup and locality

## Implemented behavior

A visitor selects resident country, language, and an eligible account region.
The catalog recommends a region but the visitor chooses. Navigation carries only
country and language in a frontend path. Email and display name are collected at
the destination; verification links are issued by and redeemed at that tenant.

All four development tenants accept any email domain and all resident countries.
`hubAPIServer.signup` controls local enabled state and `emailDomainMode`
(`any_domain` or `allowlist`). The existing admin domain screen edits the
allowlist; it does not change these operator-owned settings. Completion rechecks
both region eligibility and domain admission. A policy refusal never creates a
user. Already completed idempotent requests retain their original result.

An email may identify independent accounts in different tenants. DIDs are
immutable, location-neutral UUIDv7 identifiers. Handles contain a readable
five-character prefix and the full DID without hyphens, so account creation
requires no global short-ID allocation. The existing short-ID API remains
available for future consumers.

`preferred_job_countries` is initialized to residence during signup and changed
through an authenticated profile endpoint. Residence changes do not change job
preferences, hosting location, or identity. Neither field is public profile data
in the current API. An empty job-country preference means no country filter.

## Discovery and outage behavior

Browser -> tenant hub API -> tenant mesh API -> global coordinator.

The coordinator's discovery endpoint is authenticated and uses the private mesh.
It contains deployment catalog data only: no profiles, connections, hiring
records, credentials, or account directory. The existing loopback host binding
remains for development integration tests; it is not public portal ingress.

`signupRegionsFile` points to the mounted, versioned catalog. Each hub and mesh
process has its own bundled copy, so even a cold start can serve discovery while
the coordinator is unavailable. Both hops have bounded timeouts and fall back to
their own catalog. This is deployment configuration, not a live replicated
policy database. Reload by restarting with the new manifest. A stale catalog may
recommend a destination which subsequently refuses signup; destination admission
is authoritative and the user can choose again.

Catalog `allowedCountries: []` means all countries. Disabled catalog regions are
excluded. Unknown tenant IDs are rejected for admission. Region IDs are open
strings, not a four-value enum. Recommendations have a configurable default.
Catalog pages use tenant-ID keysets bound to country and the catalog contents.

CI deliberately differs: Singapore exercises allowlist mode; Germany is closed;
India's mesh cannot reach the coordinator and exercises local fallback; the US
and India exercise any-domain admission. These are isolated fixture policies,
not development defaults. Production manifests must add catalog mounts, mesh
configuration, and explicit admission settings before deploying these binaries;
production rollout is outside this change.

## Future federation and migration

This change does not implement account routing, cross-tenant business workflows,
or user migration. Before implementing those flows:

- Add a minimal DID-to-home-tenant directory with routing versions; persist local
  routing caches so ordinary operations do not depend on the global service.
- Give each business aggregate exactly one authoritative tenant owner. Follow
  edges belong to the follower; mutual connections need a deterministic owner.
  Store remote principals by DID, not a required local account row.
- Keep applications, interviews, and offers with the hiring org; migration moves
  the user-owned records and maintains access to org-owned active workflows.
- Transfer changes and pending work, fence source writes, verify the copy, then
  coordinate a versioned routing handover. During a global outage, retain source
  authority and defer handover. Preserve forwarding records for stale callers.
- Transfer idempotency state, security state with re-encryption, outboxes, and
  scheduled work. Migration cleanup must not invoke account-deletion cascades.
- Resolve a destination email collision explicitly before transfer; equal emails
  never imply account merging. Preserve DID and handle through relocation.
- Produce expansion reports from aggregate tenant counts by residence and
  activity, rather than centrally collecting individual user business data.

## Verification coverage

`signup-regions.spec.ts` covers global/hub discovery, invalid requests, private
endpoint authentication, offline signup, independent same-email accounts, and
closed-tenant initiation/completion. The private mesh route is covered by the
shared HTTP handler tests and the deployed hub-to-mesh discovery tests; it has no
host port for direct Playwright authentication probes. Discovery's declared 500
is a transport/runtime fallback, with no database dependency to fault-inject.

`hub-auth.spec.ts` and `hub-audit.spec.ts` cover preference validation, residence
independence, and rollback when the audit write fails. Browser tests cover region
selection, cross-origin continuation, required fields, policy rejection, retry,
empty results, and successful initiation. Signup rate limiting remains the
existing ingress backlog, not a new process-local implementation.
