-- name: CountConnectionsAtDomain :one
SELECT COUNT(*) as count FROM hub_user_connections WHERE me = $1 AND status = 'connected';

-- name: ListConnectionsAtDomain :many
SELECT * FROM hub_user_connections WHERE me = $1 AND status = 'connected' ORDER BY connected_at DESC;

-- name: ListNetworkOpportunities :many
SELECT DISTINCT org_id FROM openings WHERE status = 'published' LIMIT 20;
