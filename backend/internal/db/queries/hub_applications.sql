-- Applied only for an event newer than the inbox watermark, so the row always
-- reflects the newest change of the application.
-- name: UpsertHubApplicationProjection :exec
INSERT INTO vetchium.hub_application_projections (
    projection_id, hub_user_did, org_did, org_domain, org_display_name,
    opening_number, opening_title, application_number, hub_status,
    pending_actions, applied_at, last_activity_at
)
VALUES (
    sqlc.arg(projection_id), sqlc.arg(hub_user_did), sqlc.arg(org_did),
    sqlc.arg(org_domain), sqlc.arg(org_display_name),
    sqlc.arg(opening_number)::integer, sqlc.arg(opening_title),
    sqlc.arg(application_number)::integer, sqlc.arg(hub_status),
    sqlc.arg(pending_actions)::text[], sqlc.arg(applied_at),
    sqlc.arg(last_activity_at)
)
ON CONFLICT (hub_user_did, org_did, opening_number, application_number)
DO UPDATE SET org_domain = EXCLUDED.org_domain,
    org_display_name = EXCLUDED.org_display_name,
    opening_title = EXCLUDED.opening_title, hub_status = EXCLUDED.hub_status,
    pending_actions = EXCLUDED.pending_actions,
    applied_at = EXCLUDED.applied_at,
    last_activity_at = EXCLUDED.last_activity_at, updated_at = now();

-- name: ListHubApplicationProjections :many
SELECT projection_id, org_domain::text AS org_domain, org_display_name,
    opening_number, opening_title, application_number, hub_status,
    pending_actions, applied_at, last_activity_at
FROM vetchium.hub_application_projections
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND (sqlc.narg(after_activity_at)::timestamptz IS NULL
      OR (last_activity_at, projection_id) <
         (sqlc.narg(after_activity_at)::timestamptz,
          sqlc.narg(after_projection_id)::uuid))
ORDER BY last_activity_at DESC, projection_id DESC
LIMIT sqlc.arg(page_limit);
