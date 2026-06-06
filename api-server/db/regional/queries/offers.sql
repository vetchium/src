-- name: CreateOffer :one
INSERT INTO offers (candidacy_id, offer_letter_s3_key, start_date, notes, extended_by_org_user_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetOfferByCandidacyID :one
SELECT * FROM offers WHERE candidacy_id = $1;

-- name: DeleteOffer :exec
DELETE FROM offers WHERE candidacy_id = $1;
