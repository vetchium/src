-- name: CreateCandidacy :one
INSERT INTO candidacies (application_id, org_id, opening_id, applicant_hub_user_global_id, state)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetCandidacy :one
SELECT * FROM candidacies WHERE candidacy_id = $1;

-- name: ListCandidaciesForOrg :many
SELECT * FROM candidacies WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3;

-- name: AddCandidacyComment :one
INSERT INTO candidacy_comments (candidacy_id, body, author_hub_user_global_id)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetCandidacyCommentThread :many
SELECT * FROM candidacy_comments WHERE candidacy_id = $1 ORDER BY created_at ASC;

-- name: AddSystemComment :one
INSERT INTO candidacy_comments (candidacy_id, body, is_system)
VALUES ($1, $2, true)
RETURNING *;
