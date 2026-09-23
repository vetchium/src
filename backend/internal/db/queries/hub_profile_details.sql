-- name: GetHubPublicProfile :one
SELECT
    u.display_name,
    u.handle,
    u.profile_alias,
    u.resident_country,
    u.biography,
    u.profile_version,
    picture.object_id AS profile_picture_object_id,
    COALESCE(picture.format::text, '')::text AS profile_picture_format,
    COALESCE(work.items, '[]'::jsonb) AS work_experiences,
    COALESCE(certifications.items, '[]'::jsonb) AS certifications,
    COALESCE(languages.items, '[]'::jsonb) AS language_abilities,
    COALESCE(education.items, '[]'::jsonb) AS educational_qualifications
FROM vetchium.hub_users AS u
LEFT JOIN LATERAL (
    SELECT p.object_id, p.format
    FROM vetchium.hub_profile_picture_objects AS p
    WHERE p.hub_user_did = u.hub_user_did AND p.state = 'active'
) AS picture ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', w.work_experience_id,
            'employer_domain', w.employer_domain,
            'job_title', w.job_title,
            'start_month', to_char(w.start_month, 'YYYY-MM'),
            'end_month', to_char(w.end_month, 'YYYY-MM'),
            'location', w.location,
            'description', w.description
        ) ORDER BY (w.end_month IS NULL) DESC, w.start_month DESC,
            w.work_experience_id
    ) AS items
    FROM vetchium.hub_work_experiences AS w
    WHERE w.hub_user_did = u.hub_user_did
) AS work ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', c.certification_id,
            'title', c.title,
            'credential_url', c.credential_url
        ) ORDER BY c.created_at DESC, c.certification_id
    ) AS items
    FROM vetchium.hub_certifications AS c
    WHERE c.hub_user_did = u.hub_user_did
) AS certifications ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
        jsonb_build_object('ability', l.ability, 'language_tag', l.language_tag)
        ORDER BY l.ability, l.language_tag
    ) AS items
    FROM vetchium.hub_language_abilities AS l
    WHERE l.hub_user_did = u.hub_user_did
) AS languages ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', e.educational_qualification_id,
            'institution_domain', e.institution_domain,
            'degree', e.degree,
            'title', e.title,
            'supporting_text', e.supporting_text,
            'start_month', to_char(e.start_month, 'YYYY-MM'),
            'end_month', to_char(e.end_month, 'YYYY-MM')
        ) ORDER BY
            CASE
                WHEN e.start_month IS NOT NULL AND e.end_month IS NULL THEN 0
                WHEN e.start_month IS NOT NULL THEN 1
                WHEN e.end_month IS NOT NULL THEN 2
                ELSE 3
            END,
            e.start_month DESC NULLS LAST,
            e.end_month DESC NULLS LAST,
            e.educational_qualification_id
    ) AS items
    FROM vetchium.hub_educational_qualifications AS e
    WHERE e.hub_user_did = u.hub_user_did
) AS education ON true
WHERE u.hub_user_did = sqlc.arg(hub_user_did)
  AND u.hub_user_state = 'active';

-- name: GetHubProfileViewer :one
SELECT handle
FROM vetchium.hub_users
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND hub_user_state = 'active';

-- name: GetHubAliasState :one
SELECT u.profile_alias, u.alias_last_changed_at
FROM vetchium.hub_sessions AS s
JOIN vetchium.hub_users AS u USING (hub_user_did)
WHERE s.hub_session_id = sqlc.arg(hub_session_id)
  AND u.hub_user_did = sqlc.arg(hub_user_did)
  AND s.expires_at > now()
  AND u.hub_user_state = 'active';

-- name: SetHubPublicProfile :one
WITH previous AS (
    SELECT u.hub_user_did, u.display_name, u.biography
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    FOR UPDATE
), updated AS (
    UPDATE vetchium.hub_users AS u
    SET display_name = sqlc.arg(display_name),
        biography = sqlc.narg(biography),
        profile_version = u.profile_version + 1,
        updated_at = now()
    FROM previous
    WHERE u.hub_user_did = previous.hub_user_did
      AND (u.display_name, u.biography) IS DISTINCT FROM
          (sqlc.arg(display_name), sqlc.narg(biography))
    RETURNING u.hub_user_did, u.display_name, u.biography, u.profile_version,
        previous.display_name AS previous_display_name,
        previous.biography AS previous_biography
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.profile.public-fields-set',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1,
            'previous_display_name', previous_display_name,
            'display_name', display_name,
            'biography_changed', biography IS DISTINCT FROM previous_biography
        )
    FROM updated
)
SELECT hub_user_did, display_name, biography, profile_version FROM updated;

-- name: CreateHubWorkExperience :one
WITH owner AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    FOR UPDATE
), inserted AS (
    INSERT INTO vetchium.hub_work_experiences (
        work_experience_id, hub_user_did, employer_domain, job_title,
        start_month, end_month, location, description
    )
    SELECT
        sqlc.arg(work_experience_id), owner.hub_user_did,
        sqlc.arg(employer_domain), sqlc.arg(job_title), sqlc.arg(start_month),
        sqlc.narg(end_month), sqlc.narg(location), sqlc.narg(description)
    FROM owner
    WHERE sqlc.arg(start_month)::date <= date_trunc('month', now())::date
      AND (sqlc.narg(end_month)::date IS NULL OR
        sqlc.narg(end_month)::date <= date_trunc('month', now())::date)
      AND (SELECT count(*) FROM vetchium.hub_work_experiences AS existing
           WHERE existing.hub_user_did = owner.hub_user_did) < 50
    RETURNING work_experience_id, hub_user_did, employer_domain, job_title,
        start_month, end_month, location, description, created_at, updated_at
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM inserted)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.work-experience-created',
        'hub_work_experience', work_experience_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1, 'profile_version', versioned.profile_version,
            'employer_domain', employer_domain, 'job_title', job_title,
            'start_month', start_month, 'end_month', end_month,
            'location', location, 'has_description', description IS NOT NULL
        )
    FROM inserted CROSS JOIN versioned
)
SELECT inserted.work_experience_id, inserted.hub_user_did,
    inserted.employer_domain, inserted.job_title, inserted.start_month,
    inserted.end_month, inserted.location, inserted.description,
    inserted.created_at, inserted.updated_at, versioned.profile_version
FROM inserted CROSS JOIN versioned;

-- name: UpdateHubWorkExperience :one
WITH owner AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    FOR UPDATE
), previous AS (
    SELECT w.work_experience_id, w.employer_domain, w.job_title,
        w.start_month, w.end_month, w.location, w.description
    FROM vetchium.hub_work_experiences AS w
    JOIN owner USING (hub_user_did)
    WHERE w.work_experience_id = sqlc.arg(work_experience_id)
    FOR UPDATE OF w
), updated AS (
    UPDATE vetchium.hub_work_experiences AS w
    SET employer_domain = sqlc.arg(employer_domain),
        job_title = sqlc.arg(job_title),
        start_month = sqlc.arg(start_month),
        end_month = sqlc.narg(end_month),
        location = sqlc.narg(location),
        description = sqlc.narg(description),
        updated_at = now()
    FROM previous
    WHERE w.work_experience_id = previous.work_experience_id
      AND sqlc.arg(start_month)::date <= date_trunc('month', now())::date
      AND (sqlc.narg(end_month)::date IS NULL OR
        sqlc.narg(end_month)::date <= date_trunc('month', now())::date)
    RETURNING w.work_experience_id, w.hub_user_did, w.employer_domain,
        w.job_title, w.start_month, w.end_month, w.location, w.description,
        w.created_at, w.updated_at,
        jsonb_build_object(
            'employer_domain', previous.employer_domain
                IS DISTINCT FROM w.employer_domain,
            'job_title', previous.job_title IS DISTINCT FROM w.job_title,
            'start_month', previous.start_month IS DISTINCT FROM w.start_month,
            'end_month', previous.end_month IS DISTINCT FROM w.end_month,
            'location', previous.location IS DISTINCT FROM w.location,
            'description', previous.description IS DISTINCT FROM w.description
        ) AS field_changes
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM updated)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.work-experience-updated',
        'hub_work_experience', work_experience_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1, 'field_changes', updated.field_changes,
            'profile_version', versioned.profile_version
        )
    FROM updated CROSS JOIN versioned
)
SELECT updated.work_experience_id, updated.hub_user_did,
    updated.employer_domain, updated.job_title, updated.start_month,
    updated.end_month, updated.location, updated.description,
    updated.created_at, updated.updated_at, versioned.profile_version
FROM updated CROSS JOIN versioned;

-- name: DeleteHubWorkExperience :one
WITH deleted AS (
    DELETE FROM vetchium.hub_work_experiences AS w
    WHERE w.work_experience_id = sqlc.arg(work_experience_id)
      AND w.hub_user_did = sqlc.arg(hub_user_did)
      AND EXISTS (
          SELECT 1 FROM vetchium.hub_users AS u
          WHERE u.hub_user_did = sqlc.arg(hub_user_did)
            AND u.hub_user_state = 'active'
          FOR UPDATE
      )
    RETURNING work_experience_id, hub_user_did, employer_domain, job_title,
        start_month, end_month, location, description
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM deleted)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.work-experience-deleted',
        'hub_work_experience', work_experience_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1, 'profile_version', versioned.profile_version,
            'employer_domain', employer_domain, 'job_title', job_title,
            'start_month', start_month, 'end_month', end_month,
            'location', location, 'had_description', description IS NOT NULL
        )
    FROM deleted CROSS JOIN versioned
)
SELECT deleted.work_experience_id, versioned.profile_version
FROM deleted CROSS JOIN versioned;

-- name: CreateHubCertification :one
WITH owner AS (
    SELECT u.hub_user_did FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    FOR UPDATE
), inserted AS (
    INSERT INTO vetchium.hub_certifications (
        certification_id, hub_user_did, title, credential_url
    )
    SELECT sqlc.arg(certification_id), owner.hub_user_did,
        sqlc.arg(title), sqlc.arg(credential_url)
    FROM owner
    WHERE (SELECT count(*) FROM vetchium.hub_certifications AS existing
           WHERE existing.hub_user_did = owner.hub_user_did) < 50
    RETURNING certification_id, hub_user_did, title, credential_url,
        created_at, updated_at
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM inserted)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.certification-created',
        'hub_certification', certification_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1, 'profile_version', versioned.profile_version,
            'title', title,
            'credential_url_sha256', encode(
                sha256(convert_to(credential_url, 'UTF8')), 'hex'
            )
        )
    FROM inserted CROSS JOIN versioned
)
SELECT inserted.certification_id, inserted.hub_user_did, inserted.title,
    inserted.credential_url, inserted.created_at, inserted.updated_at,
    versioned.profile_version
FROM inserted CROSS JOIN versioned;

-- name: UpdateHubCertification :one
WITH owner AS (
    SELECT u.hub_user_did FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    FOR UPDATE
), previous AS (
    SELECT c.certification_id, c.title, c.credential_url
    FROM vetchium.hub_certifications AS c
    JOIN owner USING (hub_user_did)
    WHERE c.certification_id = sqlc.arg(certification_id)
    FOR UPDATE OF c
), updated AS (
    UPDATE vetchium.hub_certifications AS c
    SET title = sqlc.arg(title), credential_url = sqlc.arg(credential_url),
        updated_at = now()
    FROM previous
    WHERE c.certification_id = previous.certification_id
    RETURNING c.certification_id, c.hub_user_did, c.title, c.credential_url,
        c.created_at, c.updated_at,
        jsonb_build_object(
            'title', previous.title IS DISTINCT FROM c.title,
            'credential_url', previous.credential_url
                IS DISTINCT FROM c.credential_url
        ) AS field_changes
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM updated)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.certification-updated',
        'hub_certification', certification_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1, 'field_changes', updated.field_changes,
            'profile_version', versioned.profile_version
        )
    FROM updated CROSS JOIN versioned
)
SELECT updated.certification_id, updated.hub_user_did, updated.title,
    updated.credential_url, updated.created_at, updated.updated_at,
    versioned.profile_version
FROM updated CROSS JOIN versioned;

-- name: DeleteHubCertification :one
WITH deleted AS (
    DELETE FROM vetchium.hub_certifications AS c
    WHERE c.certification_id = sqlc.arg(certification_id)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND EXISTS (
          SELECT 1 FROM vetchium.hub_users AS u
          WHERE u.hub_user_did = sqlc.arg(hub_user_did)
            AND u.hub_user_state = 'active'
          FOR UPDATE
      )
    RETURNING certification_id, hub_user_did, title, credential_url
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM deleted)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.certification-deleted',
        'hub_certification', certification_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1, 'profile_version', versioned.profile_version,
            'title', title,
            'credential_url_sha256', encode(
                sha256(convert_to(credential_url, 'UTF8')), 'hex'
            )
        )
    FROM deleted CROSS JOIN versioned
)
SELECT deleted.certification_id, versioned.profile_version
FROM deleted CROSS JOIN versioned;

-- name: AddHubLanguageAbility :one
WITH owner AS (
    SELECT u.hub_user_did FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    FOR UPDATE
), inserted AS (
    INSERT INTO vetchium.hub_language_abilities (
        hub_user_did, ability, language_tag
    )
    SELECT owner.hub_user_did, sqlc.arg(ability), sqlc.arg(language_tag)
    FROM owner
    WHERE (SELECT count(*) FROM vetchium.hub_language_abilities AS existing
           WHERE existing.hub_user_did = owner.hub_user_did
             AND existing.ability = sqlc.arg(ability)) < 25
    ON CONFLICT DO NOTHING
    RETURNING hub_user_did, ability, language_tag, created_at
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM inserted)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.language-added',
        'hub_language_ability', ability::text || ':' || language_tag,
        'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1,
            'ability', ability, 'language_tag', language_tag,
            'profile_version', versioned.profile_version
        )
    FROM inserted CROSS JOIN versioned
)
SELECT inserted.hub_user_did, inserted.ability, inserted.language_tag,
    inserted.created_at, versioned.profile_version
FROM inserted CROSS JOIN versioned;

-- name: DeleteHubLanguageAbility :one
WITH deleted AS (
    DELETE FROM vetchium.hub_language_abilities AS l
    WHERE l.hub_user_did = sqlc.arg(hub_user_did)
      AND l.ability = sqlc.arg(ability)
      AND l.language_tag = sqlc.arg(language_tag)
      AND EXISTS (
          SELECT 1 FROM vetchium.hub_users AS u
          WHERE u.hub_user_did = sqlc.arg(hub_user_did)
            AND u.hub_user_state = 'active'
          FOR UPDATE
      )
    RETURNING hub_user_did, ability, language_tag
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM deleted)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.language-deleted',
        'hub_language_ability', ability::text || ':' || language_tag,
        'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1,
            'ability', ability, 'language_tag', language_tag,
            'profile_version', versioned.profile_version
        )
    FROM deleted CROSS JOIN versioned
)
SELECT deleted.language_tag, versioned.profile_version
FROM deleted CROSS JOIN versioned;

-- name: CreateHubEducationalQualification :one
WITH owner AS (
    SELECT u.hub_user_did FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    FOR UPDATE
), inserted AS (
    INSERT INTO vetchium.hub_educational_qualifications (
        educational_qualification_id, hub_user_did, institution_domain,
        degree, title, supporting_text, start_month, end_month
    )
    SELECT sqlc.arg(educational_qualification_id), owner.hub_user_did,
        sqlc.arg(institution_domain), sqlc.arg(degree), sqlc.narg(title),
        sqlc.narg(supporting_text), sqlc.narg(start_month), sqlc.narg(end_month)
    FROM owner
    WHERE (sqlc.narg(start_month)::date IS NULL OR
            sqlc.narg(start_month)::date <= date_trunc('month', now())::date)
      AND (sqlc.narg(end_month)::date IS NULL OR
            sqlc.narg(end_month)::date <= date_trunc('month', now())::date)
      AND (SELECT count(*)
           FROM vetchium.hub_educational_qualifications AS existing
           WHERE existing.hub_user_did = owner.hub_user_did) < 30
    RETURNING educational_qualification_id, hub_user_did,
        institution_domain, degree, title, supporting_text, start_month,
        end_month, created_at, updated_at
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM inserted)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.education-created',
        'hub_educational_qualification', educational_qualification_id::text,
        'hub_user', hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1, 'profile_version', versioned.profile_version,
            'institution_domain', institution_domain, 'degree', degree,
            'title', title, 'start_month', start_month,
            'end_month', end_month,
            'has_supporting_text', supporting_text IS NOT NULL
        )
    FROM inserted CROSS JOIN versioned
)
SELECT inserted.educational_qualification_id, inserted.hub_user_did,
    inserted.institution_domain, inserted.degree, inserted.title,
    inserted.supporting_text, inserted.start_month, inserted.end_month,
    inserted.created_at, inserted.updated_at, versioned.profile_version
FROM inserted CROSS JOIN versioned;

-- name: UpdateHubEducationalQualification :one
WITH owner AS (
    SELECT u.hub_user_did FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    FOR UPDATE
), previous AS (
    SELECT e.educational_qualification_id, e.institution_domain, e.degree,
        e.title, e.supporting_text, e.start_month, e.end_month
    FROM vetchium.hub_educational_qualifications AS e
    JOIN owner USING (hub_user_did)
    WHERE e.educational_qualification_id =
        sqlc.arg(educational_qualification_id)
    FOR UPDATE OF e
), updated AS (
    UPDATE vetchium.hub_educational_qualifications AS e
    SET institution_domain = sqlc.arg(institution_domain),
        degree = sqlc.arg(degree), title = sqlc.narg(title),
        supporting_text = sqlc.narg(supporting_text),
        start_month = sqlc.narg(start_month), end_month = sqlc.narg(end_month),
        updated_at = now()
    FROM previous
    WHERE e.educational_qualification_id =
            previous.educational_qualification_id
      AND (sqlc.narg(start_month)::date IS NULL OR
            sqlc.narg(start_month)::date <= date_trunc('month', now())::date)
      AND (sqlc.narg(end_month)::date IS NULL OR
            sqlc.narg(end_month)::date <= date_trunc('month', now())::date)
    RETURNING e.educational_qualification_id, e.hub_user_did,
        e.institution_domain, e.degree, e.title, e.supporting_text,
        e.start_month, e.end_month, e.created_at, e.updated_at,
        jsonb_build_object(
            'institution_domain', previous.institution_domain
                IS DISTINCT FROM e.institution_domain,
            'degree', previous.degree IS DISTINCT FROM e.degree,
            'title', previous.title IS DISTINCT FROM e.title,
            'supporting_text', previous.supporting_text
                IS DISTINCT FROM e.supporting_text,
            'start_month', previous.start_month IS DISTINCT FROM e.start_month,
            'end_month', previous.end_month IS DISTINCT FROM e.end_month
        ) AS field_changes
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM updated)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.education-updated',
        'hub_educational_qualification', educational_qualification_id::text,
        'hub_user', hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1, 'field_changes', updated.field_changes,
            'profile_version', versioned.profile_version
        )
    FROM updated CROSS JOIN versioned
)
SELECT updated.educational_qualification_id, updated.hub_user_did,
    updated.institution_domain, updated.degree, updated.title,
    updated.supporting_text, updated.start_month, updated.end_month,
    updated.created_at, updated.updated_at, versioned.profile_version
FROM updated CROSS JOIN versioned;

-- name: DeleteHubEducationalQualification :one
WITH deleted AS (
    DELETE FROM vetchium.hub_educational_qualifications AS e
    WHERE e.educational_qualification_id =
            sqlc.arg(educational_qualification_id)
      AND e.hub_user_did = sqlc.arg(hub_user_did)
      AND EXISTS (
          SELECT 1 FROM vetchium.hub_users AS u
          WHERE u.hub_user_did = sqlc.arg(hub_user_did)
            AND u.hub_user_state = 'active'
          FOR UPDATE
      )
    RETURNING educational_qualification_id, hub_user_did,
        institution_domain, degree, title, supporting_text, start_month,
        end_month
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM deleted)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.education-deleted',
        'hub_educational_qualification', educational_qualification_id::text,
        'hub_user', hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1, 'profile_version', versioned.profile_version,
            'institution_domain', institution_domain, 'degree', degree,
            'title', title, 'start_month', start_month,
            'end_month', end_month,
            'had_supporting_text', supporting_text IS NOT NULL
        )
    FROM deleted CROSS JOIN versioned
)
SELECT deleted.educational_qualification_id, versioned.profile_version
FROM deleted CROSS JOIN versioned;
