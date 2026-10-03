-- The active-state predicate and audit share the write's transaction.
-- name: SetOrgCompanyName :exec
WITH updated AS (
 UPDATE vetchium.orgs
 SET display_name = sqlc.arg(display_name), updated_at = now()
 WHERE org_did = sqlc.arg(org_did) AND org_state = 'active'
   AND display_name IS DISTINCT FROM sqlc.arg(display_name)
 RETURNING org_did
)
INSERT INTO vetchium.audit_events (
 tenant_id, action, entity_type, entity_id, actor_type, actor_id, source, payload
)
SELECT sqlc.arg(tenant_id), 'org.company.name_changed', 'org', org_did::text,
 'org_user', sqlc.arg(actor_org_user_id)::uuid::text, 'orgs-api',
 jsonb_build_object('changed_fields', jsonb_build_array('display_name'))
FROM updated;
