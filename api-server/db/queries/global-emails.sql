-- Global Email Operations (for admin emails) --

-- name: EnqueueGlobalEmail :one
-- Inserts a new email into the global email queue and returns the generated email_id
INSERT INTO emails (email_type, email_to, email_subject, email_text_body, email_html_body)
VALUES ($1, $2, $3, $4, $5)
RETURNING email_id;

-- name: GetGlobalEmailsToSend :many
-- Fetches pending emails with their attempt count and last attempt time.
-- Ordered by creation time (oldest first) to ensure fair processing.
-- Uses FOR UPDATE SKIP LOCKED to allow concurrent workers.
-- The caller should filter based on attempt count and backoff timing in application code.
SELECT
    e.email_id,
    e.email_type,
    e.email_to,
    e.email_subject,
    e.email_text_body,
    e.email_html_body,
    e.created_at,
    (SELECT COUNT(*)::int FROM email_delivery_attempts a WHERE a.email_id = e.email_id) AS attempt_count,
    (SELECT MAX(attempted_at)::timestamp FROM email_delivery_attempts a WHERE a.email_id = e.email_id) AS last_attempt_at
FROM emails e
WHERE e.email_status = 'pending'
ORDER BY e.created_at
LIMIT $1
FOR UPDATE SKIP LOCKED;

-- name: MarkGlobalEmailAsSent :exec
-- Marks an email as successfully sent
UPDATE emails SET email_status = 'sent', sent_at = NOW() WHERE email_id = $1;

-- name: MarkGlobalEmailAsFailed :exec
-- Marks an email as permanently failed (after max retries exhausted)
UPDATE emails SET email_status = 'failed' WHERE email_id = $1;

-- name: RecordGlobalDeliveryAttempt :one
-- Records a delivery attempt. error_message is NULL for successful attempts.
INSERT INTO email_delivery_attempts (email_id, error_message)
VALUES ($1, $2)
RETURNING attempt_id, attempted_at;
