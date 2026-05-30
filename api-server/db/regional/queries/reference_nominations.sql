-- name: CreateReferenceNomination :one
INSERT INTO reference_nominations (request_id, nominee_hub_user_global_id, shared_domain, overlap_start_year, overlap_end_year, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetReferenceNomination :one
SELECT * FROM reference_nominations WHERE nomination_id = $1;

-- name: ListReferenceNominationsByRequest :many
SELECT * FROM reference_nominations WHERE request_id = $1 ORDER BY nominated_at DESC;

-- name: UpdateReferenceNominationState :one
UPDATE reference_nominations
SET state = $2
WHERE nomination_id = $1
RETURNING *;

-- name: MarkReferenceNominationSubmitted :one
UPDATE reference_nominations
SET state = 'submitted', submitted_at = NOW()
WHERE nomination_id = $1
RETURNING *;

-- name: ListReferenceNominationsByNomineeAndRequest :one
SELECT * FROM reference_nominations
WHERE request_id = $1 AND nominee_hub_user_global_id = $2;
