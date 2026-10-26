-- name: OrgUserCanApproveOpening :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.org_effective_permissions AS ep
    WHERE ep.org_user_id = sqlc.arg(actor_id)
      AND ep.permission = 'org:approve_openings'
) AS can_approve;

-- A version bump serializes requests with edits and other decisions. The
-- pending index remains the final guard against a second pending request.
-- name: RequestOrgOpeningChange :one
WITH actor AS (
    SELECT EXISTS (
        SELECT 1 FROM vetchium.org_effective_permissions AS ep
        WHERE ep.org_user_id = sqlc.arg(actor_id)
          AND ep.permission = 'org:manage_openings'
    ) AS can_manage, EXISTS (
        SELECT 1 FROM vetchium.org_effective_permissions AS ep
        WHERE ep.org_user_id = sqlc.arg(actor_id)
          AND ep.permission = 'org:approve_openings'
    ) AS can_approve
), changed AS (
    UPDATE vetchium.org_openings AS o
    SET version = o.version + 1, updated_at = now(),
        opening_state = CASE
            WHEN actor.can_approve AND sqlc.arg(kind)::text = 'publish'
                THEN 'published'::vetchium.org_opening_state
            WHEN actor.can_approve AND sqlc.arg(kind)::text = 'pause'
                THEN 'paused'::vetchium.org_opening_state
            WHEN actor.can_approve AND sqlc.arg(kind)::text = 'reopen'
                THEN 'published'::vetchium.org_opening_state
            WHEN actor.can_approve AND sqlc.arg(kind)::text = 'close'
                THEN 'closed'::vetchium.org_opening_state
            ELSE o.opening_state END,
        revision = o.revision + CASE WHEN actor.can_approve
            AND sqlc.arg(kind)::text = 'revise' THEN 1 ELSE 0 END,
        first_published_at = CASE WHEN actor.can_approve
            AND sqlc.arg(kind)::text = 'publish' THEN now()
            ELSE o.first_published_at END,
        expires_at = CASE WHEN actor.can_approve
            AND sqlc.arg(kind)::text = 'publish'
            THEN now() + interval '180 days' ELSE o.expires_at END,
        last_revised_at = CASE WHEN actor.can_approve
            AND sqlc.arg(kind)::text = 'revise' THEN now()
            ELSE o.last_revised_at END,
        ended_at = CASE WHEN actor.can_approve
            AND sqlc.arg(kind)::text = 'close' THEN now()
            ELSE o.ended_at END
    FROM actor
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND o.version = sqlc.arg(version)::integer
      AND actor.can_manage
      AND (
          (sqlc.arg(kind)::text = 'publish' AND o.opening_state = 'draft')
          OR (sqlc.arg(kind)::text = 'revise'
              AND o.opening_state IN ('published', 'paused')
              AND EXISTS (SELECT 1 FROM vetchium.org_opening_contents AS c
                  WHERE c.org_opening_id = o.org_opening_id
                    AND c.slot = 'working'))
          OR (sqlc.arg(kind)::text = 'pause'
              AND o.opening_state = 'published')
          OR (sqlc.arg(kind)::text = 'reopen'
              AND o.opening_state = 'paused')
          OR (sqlc.arg(kind)::text = 'close'
              AND o.opening_state IN ('published', 'paused'))
      )
      AND (sqlc.arg(kind)::text NOT IN ('publish', 'revise')
          OR (EXISTS (SELECT 1 FROM vetchium.org_opening_contents AS c
              WHERE c.org_opening_id = o.org_opening_id
                AND c.slot = 'working' AND c.complete)
              AND EXISTS (SELECT 1 FROM vetchium.org_users AS u
                  WHERE u.org_user_id = o.hiring_manager_id
                    AND u.org_did = o.org_did AND u.org_user_state = 'active')
              AND EXISTS (SELECT 1 FROM vetchium.org_users AS u
                  WHERE u.org_user_id = o.recruiter_id
                    AND u.org_did = o.org_did AND u.org_user_state = 'active')))
      AND (NOT EXISTS (SELECT 1 FROM vetchium.org_opening_requests AS r
              WHERE r.org_opening_id = o.org_opening_id
                AND r.request_state = 'pending')
          OR (actor.can_approve AND sqlc.arg(kind)::text = 'close'))
    RETURNING o.org_opening_id, o.opening_number, o.version,
        actor.can_approve
), superseded AS (
    UPDATE vetchium.org_opening_requests AS r
    SET request_state = 'superseded', decided_at = now()
    FROM changed
    WHERE changed.can_approve AND sqlc.arg(kind)::text = 'close'
      AND r.org_opening_id = changed.org_opening_id
      AND r.request_state = 'pending'
    RETURNING r.org_opening_id, r.org_opening_request_id, r.request_kind
), requested AS (
    INSERT INTO vetchium.org_opening_requests (
        org_opening_request_id, org_opening_id, request_kind,
        request_state, requested_by, request_note, decided_by,
        decided_at, self_approved, mark_applications_not_progressing
    )
    SELECT sqlc.arg(request_id), changed.org_opening_id,
        sqlc.arg(kind)::vetchium.org_opening_request_kind,
        CASE WHEN changed.can_approve
            THEN 'approved'::vetchium.org_opening_request_state
            ELSE 'pending'::vetchium.org_opening_request_state END,
        sqlc.arg(actor_id), sqlc.narg(note)::text,
        CASE WHEN changed.can_approve THEN sqlc.arg(actor_id)::uuid END,
        CASE WHEN changed.can_approve THEN now() END,
        changed.can_approve,
        sqlc.arg(kind)::text = 'close'
            AND COALESCE(sqlc.narg(mark_applications)::boolean, false)
    FROM changed
    RETURNING org_opening_id, org_opening_request_id, request_kind,
        request_state
), live AS (
    INSERT INTO vetchium.org_opening_contents (
        org_opening_id, slot, title, description, language,
        employing_country, work_arrangement, location_details,
        remote_eligibility, remote_countries, employment_type,
        positions, experience_min, experience_max, minimum_education,
        salary_currency, salary_min, salary_max, salary_period, updated_by,
        updated_at
    )
    SELECT changed.org_opening_id, 'live', c.title, c.description,
        c.language, c.employing_country, c.work_arrangement,
        c.location_details, c.remote_eligibility, c.remote_countries,
        c.employment_type, c.positions, c.experience_min, c.experience_max,
        c.minimum_education, c.salary_currency, c.salary_min,
        c.salary_max, c.salary_period, sqlc.arg(actor_id), now()
    FROM changed
    JOIN vetchium.org_opening_contents AS c
      ON c.org_opening_id = changed.org_opening_id AND c.slot = 'working'
    WHERE changed.can_approve AND sqlc.arg(kind)::text IN ('publish', 'revise')
    ON CONFLICT (org_opening_id, slot) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        language = EXCLUDED.language,
        employing_country = EXCLUDED.employing_country,
        work_arrangement = EXCLUDED.work_arrangement,
        location_details = EXCLUDED.location_details,
        remote_eligibility = EXCLUDED.remote_eligibility,
        remote_countries = EXCLUDED.remote_countries,
        employment_type = EXCLUDED.employment_type,
        positions = EXCLUDED.positions,
        experience_min = EXCLUDED.experience_min,
        experience_max = EXCLUDED.experience_max,
        minimum_education = EXCLUDED.minimum_education,
        salary_currency = EXCLUDED.salary_currency,
        salary_min = EXCLUDED.salary_min,
        salary_max = EXCLUDED.salary_max,
        salary_period = EXCLUDED.salary_period,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
    RETURNING org_opening_id
), removed_working AS (
    DELETE FROM vetchium.org_opening_contents AS c
    USING changed
    WHERE changed.can_approve
      AND sqlc.arg(kind)::text IN ('publish', 'revise', 'close')
      AND c.org_opening_id = changed.org_opening_id AND c.slot = 'working'
    RETURNING c.org_opening_id
), request_history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, org_opening_request_id, request_kind,
        request_state, opening_version
    )
    SELECT sqlc.arg(history_id), changed.org_opening_id,
        CASE WHEN changed.can_approve
            THEN 'self_approved'::vetchium.org_opening_history_action
            ELSE 'requested'::vetchium.org_opening_history_action END,
        sqlc.arg(actor_id), requested.org_opening_request_id,
        requested.request_kind, requested.request_state, changed.version
    FROM changed JOIN requested USING (org_opening_id)
    RETURNING org_opening_id
), superseded_history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, org_opening_request_id, request_kind,
        request_state, opening_version
    )
    SELECT sqlc.arg(superseded_history_id), superseded.org_opening_id,
        'superseded', sqlc.arg(actor_id), superseded.org_opening_request_id,
        superseded.request_kind, 'superseded', changed.version
    FROM superseded JOIN changed USING (org_opening_id)
    RETURNING org_opening_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id),
        CASE WHEN changed.can_approve THEN 'org.opening.self-approved'
            ELSE 'org.opening.requested' END,
        'org_opening', sqlc.arg(org_did)::text || ':' ||
            changed.opening_number::text,
        'org_user', sqlc.arg(actor_id)::text, 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', changed.opening_number,
            'action', CASE WHEN changed.can_approve
                THEN 'self_approved' ELSE 'requested' END,
            'request_kind', sqlc.arg(kind)::text,
            'outcome', requested.request_state::text,
            'version', changed.version)
    FROM changed JOIN requested USING (org_opening_id)
    RETURNING audit_event_id
), superseded_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.superseded', 'org_opening',
        sqlc.arg(org_did)::text || ':' || changed.opening_number::text,
        'org_user', sqlc.arg(actor_id)::text, 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', changed.opening_number,
            'action', 'superseded', 'request_kind', superseded.request_kind,
            'outcome', 'superseded', 'version', changed.version)
    FROM superseded JOIN changed USING (org_opening_id)
    RETURNING audit_event_id
)
SELECT COALESCE((SELECT version FROM changed), 0)::integer AS version,
    COALESCE((SELECT can_approve FROM changed), false)::boolean AS self_approved,
    (SELECT count(*) FROM requested) AS request_rows,
    (SELECT count(*) FROM superseded) AS superseded_rows,
    (SELECT count(*) FROM live) AS live_rows,
    (SELECT count(*) FROM removed_working) AS removed_working_rows,
    (SELECT count(*) FROM request_history) AS history_rows,
    (SELECT count(*) FROM superseded_history) AS superseded_history_rows,
    (SELECT count(*) FROM audit) AS audit_rows,
    (SELECT count(*) FROM superseded_audit) AS superseded_audit_rows;

-- name: DecideOrgOpeningRequest :one
WITH pending AS (
    SELECT r.org_opening_request_id, r.org_opening_id, r.request_kind
    FROM vetchium.org_opening_requests AS r
    JOIN vetchium.org_openings AS o
      ON o.org_opening_id = r.org_opening_id
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND r.request_state = 'pending'
), changed AS (
    UPDATE vetchium.org_openings AS o
    SET version = o.version + 1, updated_at = now(),
        opening_state = CASE
            WHEN sqlc.arg(decision)::text = 'approve'
                AND pending.request_kind = 'publish'
                THEN 'published'::vetchium.org_opening_state
            WHEN sqlc.arg(decision)::text = 'approve'
                AND pending.request_kind = 'pause'
                THEN 'paused'::vetchium.org_opening_state
            WHEN sqlc.arg(decision)::text = 'approve'
                AND pending.request_kind = 'reopen'
                THEN 'published'::vetchium.org_opening_state
            WHEN sqlc.arg(decision)::text = 'approve'
                AND pending.request_kind = 'close'
                THEN 'closed'::vetchium.org_opening_state
            ELSE o.opening_state END,
        revision = o.revision + CASE WHEN sqlc.arg(decision)::text = 'approve'
            AND pending.request_kind = 'revise' THEN 1 ELSE 0 END,
        first_published_at = CASE WHEN sqlc.arg(decision)::text = 'approve'
            AND pending.request_kind = 'publish' THEN now()
            ELSE o.first_published_at END,
        expires_at = CASE WHEN sqlc.arg(decision)::text = 'approve'
            AND pending.request_kind = 'publish'
            THEN now() + interval '180 days' ELSE o.expires_at END,
        last_revised_at = CASE WHEN sqlc.arg(decision)::text = 'approve'
            AND pending.request_kind = 'revise' THEN now()
            ELSE o.last_revised_at END,
        ended_at = CASE WHEN sqlc.arg(decision)::text = 'approve'
            AND pending.request_kind = 'close' THEN now()
            ELSE o.ended_at END
    FROM pending
    WHERE pending.org_opening_id = o.org_opening_id
      AND o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND o.version = sqlc.arg(version)::integer
      AND EXISTS (
          SELECT 1 FROM vetchium.org_effective_permissions AS ep
          WHERE ep.org_user_id = sqlc.arg(actor_id)
            AND ep.permission = 'org:approve_openings'
      )
      AND (
          (pending.request_kind = 'publish' AND o.opening_state = 'draft')
          OR (pending.request_kind = 'revise'
              AND o.opening_state IN ('published', 'paused')
              AND EXISTS (SELECT 1 FROM vetchium.org_opening_contents AS c
                  WHERE c.org_opening_id = o.org_opening_id
                    AND c.slot = 'working'))
          OR (pending.request_kind = 'pause'
              AND o.opening_state = 'published')
          OR (pending.request_kind = 'reopen'
              AND o.opening_state = 'paused')
          OR (pending.request_kind = 'close'
              AND o.opening_state IN ('published', 'paused'))
      )
      AND (sqlc.arg(decision)::text <> 'approve'
          OR pending.request_kind NOT IN ('publish', 'revise')
          OR (EXISTS (SELECT 1 FROM vetchium.org_opening_contents AS c
              WHERE c.org_opening_id = o.org_opening_id
                AND c.slot = 'working' AND c.complete)
              AND EXISTS (SELECT 1 FROM vetchium.org_users AS u
                  WHERE u.org_user_id = o.hiring_manager_id
                    AND u.org_did = o.org_did AND u.org_user_state = 'active')
              AND EXISTS (SELECT 1 FROM vetchium.org_users AS u
                  WHERE u.org_user_id = o.recruiter_id
                    AND u.org_did = o.org_did AND u.org_user_state = 'active')))
    RETURNING o.org_opening_id, o.opening_number, o.version,
        pending.org_opening_request_id, pending.request_kind
), decided AS (
    UPDATE vetchium.org_opening_requests AS r
    SET request_state = CASE WHEN sqlc.arg(decision)::text = 'approve'
        THEN 'approved'::vetchium.org_opening_request_state
        ELSE 'rejected'::vetchium.org_opening_request_state END,
        decided_by = sqlc.arg(actor_id), decided_at = now(),
        decision_note = sqlc.narg(note)::text
    FROM changed
    WHERE r.org_opening_request_id = changed.org_opening_request_id
      AND r.request_state = 'pending'
    RETURNING r.org_opening_id, r.org_opening_request_id,
        r.request_kind, r.request_state
), live AS (
    INSERT INTO vetchium.org_opening_contents (
        org_opening_id, slot, title, description, language,
        employing_country, work_arrangement, location_details,
        remote_eligibility, remote_countries, employment_type,
        positions, experience_min, experience_max, minimum_education,
        salary_currency, salary_min, salary_max, salary_period, updated_by,
        updated_at
    )
    SELECT changed.org_opening_id, 'live', c.title, c.description,
        c.language, c.employing_country, c.work_arrangement,
        c.location_details, c.remote_eligibility, c.remote_countries,
        c.employment_type, c.positions, c.experience_min, c.experience_max,
        c.minimum_education, c.salary_currency, c.salary_min,
        c.salary_max, c.salary_period, sqlc.arg(actor_id), now()
    FROM changed
    JOIN vetchium.org_opening_contents AS c
      ON c.org_opening_id = changed.org_opening_id AND c.slot = 'working'
    WHERE sqlc.arg(decision)::text = 'approve'
      AND changed.request_kind IN ('publish', 'revise')
    ON CONFLICT (org_opening_id, slot) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        language = EXCLUDED.language,
        employing_country = EXCLUDED.employing_country,
        work_arrangement = EXCLUDED.work_arrangement,
        location_details = EXCLUDED.location_details,
        remote_eligibility = EXCLUDED.remote_eligibility,
        remote_countries = EXCLUDED.remote_countries,
        employment_type = EXCLUDED.employment_type,
        positions = EXCLUDED.positions,
        experience_min = EXCLUDED.experience_min,
        experience_max = EXCLUDED.experience_max,
        minimum_education = EXCLUDED.minimum_education,
        salary_currency = EXCLUDED.salary_currency,
        salary_min = EXCLUDED.salary_min,
        salary_max = EXCLUDED.salary_max,
        salary_period = EXCLUDED.salary_period,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
    RETURNING org_opening_id
), removed_working AS (
    DELETE FROM vetchium.org_opening_contents AS c
    USING changed
    WHERE sqlc.arg(decision)::text = 'approve'
      AND changed.request_kind IN ('publish', 'revise', 'close')
      AND c.org_opening_id = changed.org_opening_id AND c.slot = 'working'
    RETURNING c.org_opening_id
), history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, org_opening_request_id, request_kind,
        request_state, opening_version
    )
    SELECT sqlc.arg(history_id), changed.org_opening_id,
        CASE WHEN sqlc.arg(decision)::text = 'approve'
            THEN 'approved'::vetchium.org_opening_history_action
            ELSE 'rejected'::vetchium.org_opening_history_action END,
        sqlc.arg(actor_id), decided.org_opening_request_id,
        decided.request_kind, decided.request_state, changed.version
    FROM changed JOIN decided USING (org_opening_id)
    RETURNING org_opening_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id),
        CASE WHEN sqlc.arg(decision)::text = 'approve'
            THEN 'org.opening.approved' ELSE 'org.opening.rejected' END,
        'org_opening', sqlc.arg(org_did)::text || ':' ||
            changed.opening_number::text,
        'org_user', sqlc.arg(actor_id)::text, 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', changed.opening_number,
            'action', CASE WHEN sqlc.arg(decision)::text = 'approve'
                THEN 'approved' ELSE 'rejected' END,
            'request_kind', decided.request_kind,
            'outcome', decided.request_state::text,
            'version', changed.version)
    FROM changed JOIN decided USING (org_opening_id)
    RETURNING audit_event_id
)
SELECT COALESCE((SELECT version FROM changed), 0)::integer AS version,
    (SELECT count(*) FROM decided) AS decision_rows,
    (SELECT count(*) FROM live) AS live_rows,
    (SELECT count(*) FROM removed_working) AS removed_working_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- name: WithdrawOrgOpeningRequest :one
WITH pending AS (
    SELECT r.org_opening_request_id, r.org_opening_id,
        r.request_kind, r.requested_by
    FROM vetchium.org_opening_requests AS r
    JOIN vetchium.org_openings AS o
      ON o.org_opening_id = r.org_opening_id
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND r.request_state = 'pending'
), changed AS (
    UPDATE vetchium.org_openings AS o
    SET version = o.version + 1, updated_at = now()
    FROM pending AS p
    WHERE p.org_opening_id = o.org_opening_id
      AND o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND o.version = sqlc.arg(version)::integer
      AND o.opening_state IN ('draft', 'published', 'paused')
      AND (EXISTS (SELECT 1 FROM vetchium.org_opening_requests AS requester
              WHERE requester.org_opening_id = o.org_opening_id
                AND requester.request_state = 'pending'
                AND requester.requested_by = sqlc.arg(actor_id))
          OR EXISTS (
              SELECT 1 FROM vetchium.org_effective_permissions AS ep
              WHERE ep.org_user_id = sqlc.arg(actor_id)
                AND ep.permission = 'org:manage_openings'
          ))
    RETURNING o.org_opening_id, o.opening_number, o.version,
        p.org_opening_request_id
), withdrawn AS (
    UPDATE vetchium.org_opening_requests AS r
    SET request_state = 'withdrawn', decided_by = sqlc.arg(actor_id),
        decided_at = now()
    FROM changed
    WHERE r.org_opening_request_id = changed.org_opening_request_id
      AND r.request_state = 'pending'
    RETURNING r.org_opening_id, r.org_opening_request_id,
        r.request_kind, r.request_state
), history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, org_opening_request_id, request_kind,
        request_state, opening_version
    )
    SELECT sqlc.arg(history_id), changed.org_opening_id, 'withdrawn',
        sqlc.arg(actor_id), withdrawn.org_opening_request_id,
        withdrawn.request_kind, withdrawn.request_state, changed.version
    FROM changed JOIN withdrawn USING (org_opening_id)
    RETURNING org_opening_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.withdrawn', 'org_opening',
        sqlc.arg(org_did)::text || ':' || changed.opening_number::text,
        'org_user', sqlc.arg(actor_id)::text, 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', changed.opening_number,
            'action', 'withdrawn', 'request_kind', withdrawn.request_kind,
            'outcome', 'withdrawn', 'version', changed.version)
    FROM changed JOIN withdrawn USING (org_opening_id)
    RETURNING audit_event_id
)
SELECT COALESCE((SELECT version FROM changed), 0)::integer AS version,
    (SELECT count(*) FROM withdrawn) AS withdrawn_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows;
