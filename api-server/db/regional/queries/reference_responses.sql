-- name: CreateReferenceResponse :one
INSERT INTO reference_responses (nomination_id, question_id, response_text)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListReferenceResponsesByNomination :many
SELECT * FROM reference_responses WHERE nomination_id = $1 ORDER BY question_id;

-- name: GetResponsesByNominationID :many
SELECT
    rr.response_id,
    rr.nomination_id,
    rr.question_id,
    rr.response_text
FROM reference_responses rr
WHERE rr.nomination_id = $1
ORDER BY rr.question_id;
