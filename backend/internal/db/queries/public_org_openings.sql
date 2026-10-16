-- name: ListPublicOrgOpenings :one
WITH owning_org AS (
    SELECT o.org_did, o.display_name, o.country, logo.object_id AS logo_object_id
    FROM vetchium.org_domains AS d
    JOIN vetchium.orgs AS o ON o.org_did = d.org_did
    LEFT JOIN vetchium.org_logo_objects AS logo
      ON logo.org_did = o.org_did AND logo.state = 'active'
        AND o.org_plan_oid <> 'org-free-tier'
    WHERE d.domain = sqlc.arg(domain)
      AND d.domain_state IN ('verified', 'failing', 'releasing')
      AND o.org_state = 'active'
)
SELECT org.display_name, org.country, org.logo_object_id,
    COALESCE(list.openings, '[]'::jsonb) AS openings
FROM owning_org AS org
LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
        'opening_number', page.opening_number,
        'title', page.title,
        'employing_country', page.employing_country,
        'work_arrangement', page.work_arrangement,
        'employment_type', page.employment_type,
        'first_published_at', page.first_published_at
    ) ORDER BY page.first_published_at DESC,
        page.opening_number DESC) AS openings
    FROM (
        SELECT o.opening_number, o.first_published_at,
            c.title, c.employing_country, c.work_arrangement,
            c.employment_type
        FROM vetchium.org_openings AS o
        JOIN vetchium.org_opening_contents AS c
          ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
        WHERE o.org_did = org.org_did AND o.opening_state = 'published'
          AND o.expires_at > now()
          AND (sqlc.narg(employing_country)::text IS NULL
              OR c.employing_country = sqlc.narg(employing_country)::text)
          AND (sqlc.narg(work_arrangement)::text IS NULL
              OR c.work_arrangement::text = sqlc.narg(work_arrangement)::text)
          AND (sqlc.narg(employment_type)::text IS NULL
              OR c.employment_type::text = sqlc.narg(employment_type)::text)
          AND (sqlc.narg(title_query)::text IS NULL
              OR strpos(lower(c.title), lower(sqlc.narg(title_query)::text)) > 0)
          AND (sqlc.narg(cursor_at)::timestamptz IS NULL
              OR (o.first_published_at, o.opening_number) <
                 (sqlc.narg(cursor_at)::timestamptz,
                  sqlc.narg(cursor_number)::integer))
        ORDER BY o.first_published_at DESC, o.opening_number DESC
        LIMIT sqlc.arg(page_size)::integer
    ) AS page
) AS list ON true;

-- name: GetPublicOrgOpening :one
WITH owning_org AS (
    SELECT o.org_did, o.display_name, o.country, logo.object_id AS logo_object_id
    FROM vetchium.org_domains AS d
    JOIN vetchium.orgs AS o ON o.org_did = d.org_did
    LEFT JOIN vetchium.org_logo_objects AS logo
      ON logo.org_did = o.org_did AND logo.state = 'active'
        AND o.org_plan_oid <> 'org-free-tier'
    WHERE d.domain = sqlc.arg(domain)
      AND d.domain_state IN ('verified', 'failing', 'releasing')
      AND o.org_state = 'active'
)
SELECT org.display_name, org.country, org.logo_object_id,
    COALESCE(opening.body, 'null'::jsonb)::text AS opening_json
FROM owning_org AS org
LEFT JOIN LATERAL (
    SELECT CASE WHEN o.opening_state = 'published'
        AND o.expires_at > now() THEN
        jsonb_strip_nulls(jsonb_build_object(
            'opening_number', o.opening_number,
            'state', 'published',
            'content', jsonb_strip_nulls(jsonb_build_object(
                'title', c.title,
                'description', c.description,
                'language', c.language,
                'employing_country', c.employing_country,
                'work_arrangement', c.work_arrangement,
                'location_details', c.location_details,
                'remote_eligibility', CASE
                    WHEN c.remote_eligibility IS NULL THEN NULL
                    ELSE jsonb_strip_nulls(jsonb_build_object(
                        'kind', c.remote_eligibility,
                        'countries', c.remote_countries)) END,
                'employment_type', c.employment_type,
                'positions', c.positions,
                'experience_years', CASE WHEN c.experience_min IS NULL
                    AND c.experience_max IS NULL THEN NULL
                    ELSE jsonb_strip_nulls(jsonb_build_object(
                        'min', c.experience_min,
                        'max', c.experience_max)) END,
                'minimum_education', c.minimum_education,
                'salary', CASE WHEN c.salary_currency IS NULL THEN NULL
                    ELSE jsonb_build_object('currency', c.salary_currency,
                        'min', c.salary_min, 'max', c.salary_max,
                        'period', c.salary_period) END
            )),
            'first_published_at', o.first_published_at,
            'last_revised_at', o.last_revised_at
        )) ELSE jsonb_build_object(
            'opening_number', o.opening_number,
            'state', 'not_accepting', 'title', c.title
        ) END AS body
    FROM vetchium.org_openings AS o
    JOIN vetchium.org_opening_contents AS c
      ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
    WHERE o.org_did = org.org_did
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND o.opening_state IN ('published', 'paused', 'closed', 'expired')
) AS opening ON true;
