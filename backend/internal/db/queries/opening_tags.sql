-- The whole Opening tag catalog (OPN-TAG-006). The catalog holds at most 500
-- tags (OPN-TAG-003), so it is read without pagination.
-- name: ListOpeningTags :many
SELECT t.tag_oid, t.display_name, t.deprecated,
    COALESCE(
        jsonb_object_agg(n.language, n.display_name)
            FILTER (WHERE n.language IS NOT NULL),
        '{}'::jsonb
    )::jsonb AS localized_names
FROM vetchium.opening_tags AS t
LEFT JOIN vetchium.opening_tag_names AS n ON n.tag_oid = t.tag_oid
GROUP BY t.tag_oid
ORDER BY t.tag_oid;
