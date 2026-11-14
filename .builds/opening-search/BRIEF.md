# Opening search brief

## Summary

Signed-in Hub users on any plan get an Openings search page in the Hub portal
(`/openings`, plus a keyword box on Home). One search covers the `published`,
unexpired Openings of every active Org homed in one region (tenant). The
region defaults to the user's home region, and another region is searched
through its mesh peer; regions are never fanned out or merged. Filters:
keyword (Opening title or Org name), one Org, up to five tags (match any,
ranked by tags matched), the countries where the user may work, work
arrangement, employment type, date posted, experience fit, education, and
salary disclosed. Results are newest first with keyset paging and link to
the existing Org and Opening pages. Org page Opening cards also gain salary.
Searching records nothing about the viewer. Out of scope: cross-region
fan-out, saved searches and alerts, relevance ranking beyond tag count,
anonymous search and indexing, and AI matching.

## Research

- LinkedIn: keyword, location, date posted (24h, week, month), experience
  level, job type, on-site/hybrid/remote, company, salary.
- Indeed: keyword, location, date posted (24h, 3, 7 days), pay, job type,
  work setting, education, experience.
- Welcome to the Jungle and Wellfound: contract type, sector, experience,
  company size, salary; visa sponsorship is per-job, rarely a filter.
- Common: keyword over title and company, filters in the URL, newest or
  relevance order, saved searches with alerts.

## Questions and answers

1. What does "region" mean? A Vetchium region (tenant), picked per search,
   defaulting to home; another region through its mesh peer.
2. What does the keyword match? Case-insensitive substring of the Opening
   title or the Org display name, at least two characters.
3. How does location work? "Where I may work": countries matching on-site and
   hybrid Openings employed there and remote Openings open worldwide or to
   one of them.
4. Which extra filters? Date posted (1, 7, 30 days), experience fit,
   salary disclosed, minimum education.
5. Company filter? One Org, picked through a typeahead of Orgs in the region.
6. Tag filter? Up to five, match any; Openings holding more of the requested
   tags rank higher.
7. Result card? Title, Org logo and name, employing country, arrangement,
   employment type, salary when disclosed, tags, posted date.
8. Where does it live? `/openings` with an "Openings" navigation entry, and
   a keyword box on Home.
9. Salary on Org page cards too? Yes, through the shared
   `PublicOpeningSummary`.
10. Plans? Every signed-in Hub user may search every region.
11. Default location filter? Empty; preferred job countries are not applied.
12. Experience fit? Within range; a missing bound is open; no range matches.
13. Multi-value arrangement and employment type, and the order rules?
    Confirmed with the surface tables.

## API

| Operation | Portal API | Permission | Request | Success | Problems |
| --- | --- | --- | --- | --- | --- |
| `POST /api/hub/search-openings` | hub-api | any signed-in Hub user | `region?`, `keyword?`, `org_domain?`, `tag_oids?`, `work_countries?`, `work_arrangements?`, `employment_types?`, `posted_within_days?`, `experience_years?`, `education_level?`, `salary_disclosed?`, `pagination_key?`, `limit?` | `200 {openings: [{org, opening}], next_pagination_key?}` | `invalid-json`, `validation-failed`, `invalid-pagination-key`, `hub-authentication-required`, `hub-region-unavailable`, `internal-server-error` |
| `POST /api/hub/suggest-opening-orgs` | hub-api | any signed-in Hub user | `region?`, `query` | `200 {orgs: PublicOrg[]}` (at most 10) | the same, without `invalid-pagination-key` |
| `POST /mesh/opening-search/search`, `/mesh/opening-search/suggest-orgs` | mesh-api relay | relay credential | `{tenant_id, query}` | as above | peer problems, `hub-region-unavailable` |
| `POST /api/mesh/opening-search/search`, `/api/mesh/opening-search/suggest-orgs` | mesh-api peer | mesh client certificate | the query, without `region` | as above | `invalid-json`, `validation-failed`, `invalid-pagination-key`, `internal-server-error` |
| `PublicOpeningSummary` | hub-api, mesh | — | — | gains `salary?` | — |

## UI

| Portal | Route | Navigation | Shows and does | Who |
| --- | --- | --- | --- | --- |
| hub-ui | `/openings` | "Openings", after Home | every filter, kept in the URL; region picker; Org typeahead; result cards linking to Org and Opening pages; paging; loading, empty, region-unavailable states | every signed-in Hub user |
| hub-ui | `/` | — | keyword box opening `/openings?q=<keyword>` | every signed-in Hub user |
| hub-ui | `/org/<domain>` | — | Opening cards show salary when disclosed | every signed-in Hub user |

## Out of scope

- Searching several regions at once, merged results, and per-tenant
  projections of other tenants' Openings.
- Saved searches, alerts, and notifications.
- Relevance ranking beyond the tag count; description full-text search.
- Anonymous search and search-engine indexing.
- Prefilling from preferred job countries.
- AI matching or ranking.
- Demo video changes.
