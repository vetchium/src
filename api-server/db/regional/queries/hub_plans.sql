-- Hub plan queries (Spec 17). Regional DB.

-- name: ListHubPlans :many
SELECT plan_id, display_order, can_upload_profile_picture, can_post_messages, self_upgradeable
FROM hub_plans
WHERE status = 'active'
ORDER BY display_order ASC;

-- name: GetHubPlan :one
SELECT plan_id, display_order, can_upload_profile_picture, can_post_messages, self_upgradeable, status
FROM hub_plans
WHERE plan_id = @plan_id;

-- Single-row plan capabilities for the authenticated user (used by the
-- profile-picture upload gate and the switch handler's current-plan read).
-- name: GetHubUserPlanWithCaps :one
SELECT u.plan_id, p.can_upload_profile_picture, p.can_post_messages
FROM hub_users u
JOIN hub_plans p ON p.plan_id = u.plan_id
WHERE u.hub_user_global_id = @hub_user_global_id;

-- One round-trip for /hub/myinfo: plan caps + aggregated role names.
-- name: GetHubUserPlanAndRoles :one
SELECT
    u.plan_id,
    p.can_upload_profile_picture,
    p.can_post_messages,
    COALESCE(
        ARRAY_AGG(r.role_name ORDER BY r.role_name) FILTER (WHERE r.role_name IS NOT NULL),
        ARRAY[]::text[]
    )::text[] AS roles
FROM hub_users u
JOIN hub_plans p ON p.plan_id = u.plan_id
LEFT JOIN hub_user_roles hur ON hur.hub_user_global_id = u.hub_user_global_id
LEFT JOIN roles r ON r.role_id = hur.role_id
WHERE u.hub_user_global_id = @hub_user_global_id
GROUP BY u.plan_id, p.can_upload_profile_picture, p.can_post_messages;

-- name: SwitchHubUserPlan :one
UPDATE hub_users
SET plan_id = @plan_id,
    updated_at = NOW()
WHERE hub_user_global_id = @hub_user_global_id
RETURNING plan_id;

-- name: InsertHubPlanHistory :exec
INSERT INTO hub_user_plan_history (hub_user_global_id, from_plan_id, to_plan_id, reason)
VALUES (@hub_user_global_id, @from_plan_id, @to_plan_id, @reason);
