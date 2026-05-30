-- name: GetOrgHiringSettings :one
SELECT * FROM org_hiring_settings WHERE org_id = $1;

-- name: UpsertOrgHiringSettings :one
INSERT INTO org_hiring_settings (org_id, cool_off_days, allow_unsolicited_endorsements_default, updated_by)
VALUES ($1, $2, $3, $4)
ON CONFLICT (org_id) DO UPDATE SET
    cool_off_days = $2,
    allow_unsolicited_endorsements_default = $3,
    updated_by = $4,
    updated_at = NOW()
RETURNING *;
