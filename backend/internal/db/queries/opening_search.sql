-- Opening search over the Orgs this tenant homes (OPN-SRCH-003 to 005). A
-- NULL filter is off. matched_tags counts the requested tags an Opening holds;
-- the keyset follows the full order, whose directions differ per column.
-- ideal_job_text, sent only for the match sort, limits to Openings sharing a
-- lexeme and ranks them first (OPN-SRCH-015); without it every rank is 0.
-- name: SearchOpenings :many
WITH wanted AS (
    SELECT vetchium.ideal_job_tsquery(sqlc.narg(ideal_job_text)::text) AS tsq
)
SELECT hit.rank, hit.matched_tags, hit.domain, hit.display_name, hit.country,
    hit.logo_object_id, hit.summary
FROM (
    SELECT (CASE WHEN sqlc.narg(ideal_job_text)::text IS NULL THEN 0
            ELSE ts_rank(c.search_document, wanted.tsq) END)::real AS rank,
        d.domain, org.display_name, org.country,
        logo.object_id AS logo_object_id, o.first_published_at,
        o.opening_number,
        (SELECT count(*)
            FROM unnest(sqlc.narg(tag_oids)::text[]) AS wanted (tag_oid)
            WHERE wanted.tag_oid = ANY(c.tag_oids))::integer AS matched_tags,
        jsonb_strip_nulls(jsonb_build_object(
            'opening_number', o.opening_number,
            'title', c.title,
            'employing_country', c.employing_country,
            'work_arrangement', c.work_arrangement,
            'employment_type', c.employment_type,
            'first_published_at', o.first_published_at,
            'tags', COALESCE(to_jsonb(c.tag_oids), '[]'::jsonb),
            'salary', CASE WHEN c.salary_currency IS NULL THEN NULL
                ELSE jsonb_build_object('currency', c.salary_currency,
                    'min', c.salary_min, 'max', c.salary_max,
                    'period', c.salary_period) END
        )) AS summary
    FROM vetchium.org_openings AS o
    JOIN vetchium.org_opening_contents AS c
      ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
    JOIN vetchium.orgs AS org
      ON org.org_did = o.org_did AND org.org_state = 'active'
    JOIN vetchium.org_domains AS d
      ON d.org_did = org.org_did
        AND d.domain_state IN ('verified', 'failing', 'releasing')
    LEFT JOIN vetchium.org_logo_objects AS logo
      ON logo.org_did = org.org_did AND logo.state = 'active'
        AND org.org_plan_oid <> 'org-free-tier'
    CROSS JOIN wanted
    WHERE o.opening_state = 'published'
      AND o.expires_at > now()
      AND (sqlc.narg(ideal_job_text)::text IS NULL
          OR (wanted.tsq IS NOT NULL AND c.search_document @@ wanted.tsq))
      AND (sqlc.narg(keyword)::text IS NULL
          OR strpos(lower(c.title), lower(sqlc.narg(keyword)::text)) > 0
          OR strpos(lower(org.display_name),
              lower(sqlc.narg(keyword)::text)) > 0)
      AND (sqlc.narg(org_domain)::text IS NULL
          OR d.domain = sqlc.narg(org_domain)::text)
      AND (sqlc.narg(tag_oids)::text[] IS NULL
          OR c.tag_oids && sqlc.narg(tag_oids)::text[])
      AND (sqlc.narg(work_countries)::text[] IS NULL
          OR (c.work_arrangement IN ('on_site', 'hybrid')
              AND c.employing_country = ANY(sqlc.narg(work_countries)::text[]))
          OR (c.work_arrangement = 'remote'
              AND (c.remote_eligibility = 'worldwide'
                  OR c.remote_countries && sqlc.narg(work_countries)::text[])))
      AND (sqlc.narg(work_arrangements)::text[] IS NULL
          OR c.work_arrangement::text = ANY(sqlc.narg(work_arrangements)::text[]))
      AND (sqlc.narg(employment_types)::text[] IS NULL
          OR c.employment_type::text = ANY(sqlc.narg(employment_types)::text[]))
      AND (sqlc.narg(posted_within_days)::integer IS NULL
          OR o.first_published_at >= now()
              - make_interval(days => sqlc.narg(posted_within_days)::integer))
      AND (sqlc.narg(experience_years)::integer IS NULL
          OR ((c.experience_min IS NULL
                  OR c.experience_min <= sqlc.narg(experience_years)::integer)
              AND (c.experience_max IS NULL
                  OR c.experience_max >= sqlc.narg(experience_years)::integer)))
      -- The education enum orders levels by declaration.
      AND (sqlc.narg(education_level)::text IS NULL
          OR c.minimum_education IS NULL
          OR c.minimum_education
              <= sqlc.narg(education_level)::text::vetchium.org_opening_education)
      AND (NOT sqlc.arg(salary_disclosed)::boolean
          OR c.salary_currency IS NOT NULL)
) AS hit
WHERE sqlc.narg(cursor_at)::timestamptz IS NULL
    OR hit.rank < sqlc.narg(cursor_rank)::real
    OR (hit.rank = sqlc.narg(cursor_rank)::real
        AND (hit.matched_tags < sqlc.narg(cursor_matched_tags)::integer
            OR (hit.matched_tags = sqlc.narg(cursor_matched_tags)::integer
                AND (hit.first_published_at
                        < sqlc.narg(cursor_at)::timestamptz
                    OR (hit.first_published_at
                            = sqlc.narg(cursor_at)::timestamptz
                        AND (hit.domain > sqlc.narg(cursor_domain)::text
                            OR (hit.domain = sqlc.narg(cursor_domain)::text
                                AND hit.opening_number
                                    < sqlc.narg(cursor_number)::integer)))))))
ORDER BY hit.rank DESC, hit.matched_tags DESC, hit.first_published_at DESC,
    hit.domain, hit.opening_number DESC
LIMIT sqlc.arg(page_size)::integer;

-- Qualifying Orgs holding an Opening search could return (OPN-SRCH-007).
-- LIKE metacharacters in the query match literally.
-- name: SuggestOpeningOrgs :many
SELECT d.domain, org.display_name, org.country,
    logo.object_id AS logo_object_id
FROM vetchium.orgs AS org
JOIN vetchium.org_domains AS d
  ON d.org_did = org.org_did
    AND d.domain_state IN ('verified', 'failing', 'releasing')
LEFT JOIN vetchium.org_logo_objects AS logo
  ON logo.org_did = org.org_did AND logo.state = 'active'
    AND org.org_plan_oid <> 'org-free-tier'
WHERE org.org_state = 'active'
  AND (strpos(lower(org.display_name), lower(sqlc.arg(query)::text)) > 0
      OR d.domain LIKE replace(replace(replace(lower(sqlc.arg(query)::text),
          '\', '\\'), '%', '\%'), '_', '\_') || '%')
  AND EXISTS (
      SELECT 1
      FROM vetchium.org_openings AS o
      JOIN vetchium.org_opening_contents AS c
        ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
      WHERE o.org_did = org.org_did
        AND o.opening_state = 'published'
        AND o.expires_at > now())
ORDER BY lower(org.display_name), d.domain
LIMIT sqlc.arg(max_orgs)::integer;
