-- A provider is readable while its Org is active on a plan that allows
-- Listings and its domain is still claimed. Ordering and the keyset compare
-- the case-folded name bytewise ("C"), so every tenant and the merging
-- orgs-api agree whatever the database collation.
-- name: SearchPublicListings :many
SELECT l.capability_oid, l.headline, l.service_worldwide, l.service_countries,
    l.languages, l.indicative_price, l.check_types,
    d.domain::text AS domain, o.display_name, o.country,
    logo.object_id AS logo_object_id,
    (lower(o.display_name) COLLATE "C")::text AS sort_name
FROM vetchium.org_listings AS l
JOIN vetchium.orgs AS o ON o.org_did = l.org_did
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
LEFT JOIN vetchium.org_logo_objects AS logo
  ON logo.org_did = o.org_did AND logo.state = 'active'
    AND o.org_plan_oid = ANY(sqlc.arg(logo_plan_oids)::text[])
WHERE l.capability_oid = sqlc.arg(capability_oid)
  AND l.listing_state = 'listed'
  AND o.org_state = 'active'
  AND o.org_plan_oid = ANY(sqlc.arg(listing_plan_oids)::text[])
  AND d.domain_state IN ('verified', 'failing', 'releasing')
  AND (sqlc.narg(country)::text IS NULL OR l.service_worldwide
      OR sqlc.narg(country)::text = ANY(l.service_countries))
  AND (sqlc.narg(language)::text IS NULL
      OR sqlc.narg(language)::text = ANY(l.languages))
  AND (sqlc.narg(check_types)::text[] IS NULL
      OR l.check_types @> sqlc.narg(check_types)::text[])
  AND (sqlc.narg(query)::text IS NULL
      OR strpos(lower(o.display_name), lower(sqlc.narg(query)::text)) > 0
      OR strpos(lower(l.headline), lower(sqlc.narg(query)::text)) > 0)
  AND (sqlc.narg(after_name)::text IS NULL
      OR (lower(o.display_name) COLLATE "C", d.domain::text COLLATE "C") >
         (sqlc.narg(after_name)::text, sqlc.narg(after_domain)::text))
ORDER BY lower(o.display_name) COLLATE "C", d.domain::text COLLATE "C"
LIMIT sqlc.arg(page_limit);

-- name: GetPublicListing :one
SELECT l.capability_oid, l.headline, l.description, l.service_worldwide,
    l.service_countries, l.languages, l.indicative_price, l.check_types,
    l.consent_disclosure, d.domain::text AS domain, o.display_name, o.country,
    logo.object_id AS logo_object_id
FROM vetchium.org_listings AS l
JOIN vetchium.orgs AS o ON o.org_did = l.org_did
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
LEFT JOIN vetchium.org_logo_objects AS logo
  ON logo.org_did = o.org_did AND logo.state = 'active'
    AND o.org_plan_oid = ANY(sqlc.arg(logo_plan_oids)::text[])
WHERE d.domain = sqlc.arg(domain)
  AND l.capability_oid = sqlc.arg(capability_oid)
  AND l.listing_state = 'listed'
  AND o.org_state = 'active'
  AND o.org_plan_oid = ANY(sqlc.arg(listing_plan_oids)::text[])
  AND d.domain_state IN ('verified', 'failing', 'releasing');

-- The Listing behind an engagement this tenant holds as provider, in any
-- state of the Listing: an active engagement continues when its Listing
-- leaves search. Only the consumer the engagement names may ask.
-- name: GetEngagementListingForConsumer :one
SELECT l.capability_oid, l.check_types, l.consent_disclosure
FROM vetchium.org_engagement_projections AS p
JOIN vetchium.org_listings AS l
  ON l.org_did = p.provider_org_did AND l.capability_oid = p.capability_oid
WHERE p.engagement_id = sqlc.arg(engagement_id)
  AND p.consumer_org_did = sqlc.arg(consumer_org_did);
