-- name: CreateReferenceRequest :one
INSERT INTO reference_requests (candidacy_id, requested_by_org_user_id, max_references, response_deadline, questions)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetReferenceRequest :one
SELECT * FROM reference_requests WHERE request_id = $1;

-- name: ListReferenceRequestsByCandidacy :many
SELECT * FROM reference_requests WHERE candidacy_id = $1 ORDER BY created_at DESC;

-- name: ListReferenceNominationsByRequestID :many
SELECT * FROM reference_nominations WHERE request_id = $1 ORDER BY nominated_at DESC;

-- name: ListReferenceResponsesByNominationIDs :many
SELECT rr.nomination_id, rr.question_id, rr.response_text
FROM reference_responses rr
WHERE rr.nomination_id = ANY(@nomination_ids::uuid[])
ORDER BY rr.nomination_id, rr.question_id;

-- name: ListReferenceNominationsByNominee :many
SELECT * FROM reference_nominations
WHERE nominee_hub_user_global_id = $1
ORDER BY nominated_at DESC
LIMIT $2;

-- name: GetReferenceNomination :one
SELECT * FROM reference_nominations WHERE nomination_id = $1;

-- name: CreateReferenceNomination :one
INSERT INTO reference_nominations (request_id, nominee_hub_user_global_id, shared_domain, overlap_start_year, overlap_end_year, expires_at)
VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 days')
RETURNING *;

-- name: UpdateReferenceNominationState :one
UPDATE reference_nominations SET state = $2, submitted_at = CASE WHEN $2 = 'submitted' THEN NOW() ELSE submitted_at END
WHERE nomination_id = $1
RETURNING *;

-- name: InsertReferenceResponse :exec
INSERT INTO reference_responses (nomination_id, question_id, response_text)
VALUES ($1, $2, $3)
ON CONFLICT (nomination_id, question_id) DO UPDATE SET response_text = EXCLUDED.response_text;
