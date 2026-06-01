-- name: ScheduleInterview :one
INSERT INTO interviews (candidacy_id, interview_type, starts_at, ends_at, description, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetInterview :one
SELECT * FROM interviews WHERE interview_id = $1;

-- name: GetInterviewWithInterviewers :one
SELECT i.*,
       (SELECT json_agg(
           json_build_object(
               'interview_id', ii.interview_id,
               'org_user_id', ii.org_user_id,
               'email_address', ou.email_address,
               'full_name', ou.full_name,
               'rsvp', ii.rsvp,
               'added_at', ii.added_at,
               'feedback_submitted', (SELECT COUNT(*) > 0 FROM interview_feedback WHERE interview_id = ii.interview_id AND interviewer_org_user_id = ii.org_user_id)
           )
       ) FROM interview_interviewers ii JOIN org_users ou ON ou.org_user_id = ii.org_user_id WHERE ii.interview_id = i.interview_id) as interviewers,
       (SELECT json_agg(
           json_build_object(
               'org_user_id', ifb.interviewer_org_user_id,
               'decision', ifb.decision,
               'positives', ifb.positives,
               'negatives', ifb.negatives,
               'overall_assessment', ifb.overall_assessment,
               'candidate_feedback', ifb.candidate_feedback,
               'submitted_at', ifb.submitted_at
           )
       ) FROM interview_feedback ifb WHERE ifb.interview_id = i.interview_id) as feedback
FROM interviews i
WHERE i.interview_id = $1;

-- name: UpdateInterview :one
UPDATE interviews
SET starts_at = COALESCE($2, starts_at),
    ends_at = COALESCE($3, ends_at),
    description = COALESCE($4, description),
    state_changed_at = NOW()
WHERE interview_id = $1
RETURNING *;

-- name: CancelInterview :one
UPDATE interviews
SET state = 'cancelled', state_changed_at = NOW()
WHERE interview_id = $1 AND state = 'scheduled'
RETURNING *;

-- name: CompleteInterview :one
UPDATE interviews
SET state = 'completed', state_changed_at = NOW()
WHERE interview_id = $1
RETURNING *;

-- name: SetCandidateRSVP :one
UPDATE interviews
SET candidate_rsvp = $2, state_changed_at = NOW()
WHERE interview_id = $1
RETURNING *;

-- name: AddInterviewer :exec
INSERT INTO interview_interviewers (interview_id, org_user_id)
VALUES ($1, $2)
ON CONFLICT (interview_id, org_user_id) DO NOTHING;

-- name: RemoveInterviewer :exec
DELETE FROM interview_interviewers WHERE interview_id = $1 AND org_user_id = $2;

-- name: SetInterviewerRSVP :one
UPDATE interview_interviewers
SET rsvp = $3
WHERE interview_id = $1 AND org_user_id = $2
RETURNING *;

-- name: SubmitInterviewFeedback :one
INSERT INTO interview_feedback (interview_id, interviewer_org_user_id, decision, positives, negatives, overall_assessment, candidate_feedback)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (interview_id, interviewer_org_user_id)
DO UPDATE SET
    decision = EXCLUDED.decision,
    positives = EXCLUDED.positives,
    negatives = EXCLUDED.negatives,
    overall_assessment = EXCLUDED.overall_assessment,
    candidate_feedback = EXCLUDED.candidate_feedback,
    submitted_at = NOW()
RETURNING *;

-- name: CancelAllScheduledForCandidacy :exec
UPDATE interviews
SET state = 'cancelled', state_changed_at = NOW()
WHERE candidacy_id = $1 AND state = 'scheduled';

-- name: ListInterviewsForCandidacy :many
SELECT * FROM interviews
WHERE candidacy_id = $1
ORDER BY starts_at DESC;

-- name: ListInterviewsByCandidacyID :many
SELECT * FROM interviews
WHERE candidacy_id = $1
ORDER BY starts_at DESC
LIMIT $2 OFFSET $3;

-- name: CountInterviewersForInterview :one
SELECT COUNT(*) as count FROM interview_interviewers WHERE interview_id = $1;

-- name: CountFeedbackForInterview :one
SELECT COUNT(*) as count FROM interview_feedback WHERE interview_id = $1;

-- name: GetInterviewerEntry :one
SELECT ii.org_user_id, ii.rsvp, ii.added_at,
       CASE WHEN EXISTS(SELECT 1 FROM interview_feedback WHERE interview_id = ii.interview_id AND interviewer_org_user_id = ii.org_user_id) THEN true ELSE false END as feedback_submitted
FROM interview_interviewers ii
WHERE ii.interview_id = $1 AND ii.org_user_id = $2;

-- name: GetInterviewsByStartsAtRange :many
SELECT * FROM interviews
WHERE starts_at >= $1 AND starts_at <= $2
ORDER BY starts_at ASC;

-- name: ListInterviewerEmailsForInterview :many
SELECT ou.email_address, ou.full_name
FROM interview_interviewers ii
JOIN org_users ou ON ou.org_user_id = ii.org_user_id
WHERE ii.interview_id = $1;

-- name: ListMyInterviewsForOrgUser :many
-- Interviews the given org user is personally assigned to, within their org,
-- enriched with opening/candidate context and the caller's own RSVP/feedback.
-- Keyset paginated ascending by (starts_at, interview_id) so soonest is first.
SELECT
    i.interview_id,
    i.candidacy_id,
    i.interview_type,
    i.starts_at,
    i.ends_at,
    i.state,
    o.title AS opening_title,
    a.applicant_display_name_snapshot AS candidate_name,
    ii.rsvp AS my_rsvp,
    EXISTS(
        SELECT 1 FROM interview_feedback f
        WHERE f.interview_id = i.interview_id
          AND f.interviewer_org_user_id = sqlc.arg('org_user_id')
    ) AS feedback_submitted
FROM interview_interviewers ii
JOIN interviews i ON i.interview_id = ii.interview_id
JOIN candidacies c ON c.candidacy_id = i.candidacy_id
JOIN openings o ON o.opening_id = c.opening_id
JOIN applications a ON a.application_id = c.application_id
WHERE ii.org_user_id = sqlc.arg('org_user_id')
  AND c.org_id = sqlc.arg('org_id')
  AND (sqlc.narg('filter_states')::text[] IS NULL OR i.state = ANY(sqlc.narg('filter_states')::text[]))
  AND (
    sqlc.narg('cursor_starts_at')::timestamptz IS NULL
    OR (i.starts_at, i.interview_id) > (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_interview_id')::uuid)
  )
ORDER BY i.starts_at ASC, i.interview_id ASC
LIMIT sqlc.arg('lim');

-- name: ListMyInterviewsForHubUser :many
-- All interviews belonging to the given candidate (across their candidacies in
-- this region), enriched with opening context. Keyset paginated ascending by
-- (starts_at, interview_id).
SELECT
    i.interview_id,
    i.candidacy_id,
    i.interview_type,
    i.starts_at,
    i.ends_at,
    i.state,
    i.candidate_rsvp,
    o.title AS opening_title
FROM interviews i
JOIN candidacies c ON c.candidacy_id = i.candidacy_id
JOIN openings o ON o.opening_id = c.opening_id
WHERE c.applicant_hub_user_global_id = sqlc.arg('hub_user_global_id')
  AND (sqlc.narg('filter_states')::text[] IS NULL OR i.state = ANY(sqlc.narg('filter_states')::text[]))
  AND (
    sqlc.narg('cursor_starts_at')::timestamptz IS NULL
    OR (i.starts_at, i.interview_id) > (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_interview_id')::uuid)
  )
ORDER BY i.starts_at ASC, i.interview_id ASC
LIMIT sqlc.arg('lim');
