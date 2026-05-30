-- name: GetApplicationByID :one
SELECT * FROM applications WHERE application_id = $1;

-- name: CreateApplication :one
INSERT INTO applications (
    org_id, opening_id, opening_number, applicant_hub_user_global_id,
    applicant_handle_snapshot, applicant_display_name_snapshot,
    cover_letter, resume_s3_key, state, notify_colleagues_at_target
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: ListApplicationsForOpening :many
SELECT * FROM applications WHERE opening_id = $1 ORDER BY applied_at DESC LIMIT $2 OFFSET $3;

-- name: WithdrawApplication :exec
UPDATE applications SET state = 'withdrawn', state_changed_at = NOW() WHERE application_id = $1;

-- name: ShortlistApplication :exec
UPDATE applications SET state = 'shortlisted', state_changed_at = NOW() WHERE application_id = $1;

-- name: RejectApplication :exec
UPDATE applications SET state = 'rejected', state_changed_at = NOW(), rejection_reason = $2 WHERE application_id = $1;

-- name: LabelApplication :exec
UPDATE applications SET label = $2 WHERE application_id = $1;
