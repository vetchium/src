-- name: CreateAdminInvitation :one
WITH existing_user AS (
    SELECT 1
    FROM vetchium.admin_users AS u
    WHERE u.email_address = sqlc.arg(target_email_address)
), upserted AS (
    INSERT INTO vetchium.admin_invitations (
        admin_invitation_id,
        email_address,
        token_hash,
        invited_by,
        expires_at
    )
    SELECT
        sqlc.arg(admin_invitation_id),
        sqlc.arg(target_email_address),
        sqlc.arg(token_hash),
        sqlc.arg(invited_by),
        sqlc.arg(expires_at)
    WHERE NOT EXISTS (SELECT 1 FROM existing_user)
    ON CONFLICT (email_address) WHERE active DO UPDATE
    SET admin_invitation_id = EXCLUDED.admin_invitation_id,
        token_hash = EXCLUDED.token_hash,
        invited_by = EXCLUDED.invited_by,
        created_at = EXCLUDED.created_at,
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL,
        active = true
    WHERE admin_invitations.expires_at <= now()
    RETURNING admin_invitation_id, expires_at
), outbox AS (
    INSERT INTO vetchium.admin_email_outbox (
        kind,
        recipient_email_address,
        payload_ciphertext
    )
    SELECT
        'invitation',
        sqlc.arg(target_email_address),
        sqlc.arg(payload_ciphertext)
    FROM upserted
    RETURNING admin_email_outbox_id
)
SELECT
    CASE
        WHEN EXISTS (SELECT 1 FROM upserted) THEN 'ok'
        WHEN EXISTS (SELECT 1 FROM existing_user) THEN 'user_exists'
        ELSE 'pending'
    END::text AS result,
    (SELECT admin_invitation_id FROM upserted) AS admin_invitation_id,
    (SELECT expires_at FROM upserted) AS expires_at,
    EXISTS (SELECT 1 FROM outbox) AS queued;

-- name: CompleteAdminSetup :one
WITH invitation AS (
    SELECT i.admin_invitation_id, i.email_address
    FROM vetchium.admin_invitations AS i
    WHERE i.token_hash = sqlc.arg(invitation_token_hash)
      AND i.active
      AND i.consumed_at IS NULL
      AND i.expires_at > now()
    FOR UPDATE
), existing_user AS (
    SELECT 1
    FROM vetchium.admin_users
    WHERE email_address = (SELECT email_address FROM invitation)
), inserted_user AS (
    INSERT INTO vetchium.admin_users (
        admin_user_id,
        email_address,
        display_name,
        password_hash,
        primary_display_name_language,
        preferred_language
    )
    SELECT
        sqlc.arg(new_admin_user_id),
        email_address,
        sqlc.arg(primary_display_name),
        sqlc.arg(password_hash),
        sqlc.arg(primary_language),
        sqlc.arg(preferred_language)
    FROM invitation
    WHERE NOT EXISTS (SELECT 1 FROM existing_user)
    ON CONFLICT (email_address) DO NOTHING
    RETURNING admin_user_id
), names AS (
    INSERT INTO vetchium.admin_display_names (
        admin_user_id,
        language_code,
        display_name
    )
    SELECT
        u.admin_user_id,
        names.language_code,
        names.display_name
    FROM inserted_user AS u
    CROSS JOIN LATERAL (
        SELECT
            unnest(sqlc.arg(language_codes)::text[]) AS language_code,
            unnest(sqlc.arg(display_names)::text[]) AS display_name
    ) AS names
    RETURNING admin_user_id
), consumed AS (
    UPDATE vetchium.admin_invitations
    SET consumed_at = now(),
        active = false
    WHERE admin_invitation_id = (
        SELECT admin_invitation_id FROM invitation
    )
      AND EXISTS (SELECT 1 FROM inserted_user)
      AND EXISTS (SELECT 1 FROM names)
    RETURNING admin_invitation_id
)
SELECT
    CASE
        WHEN EXISTS (SELECT 1 FROM inserted_user) AND
            EXISTS (SELECT 1 FROM consumed) THEN 'ok'
        WHEN NOT EXISTS (SELECT 1 FROM invitation) THEN 'invalid_token'
        ELSE 'user_exists'
    END::text AS result,
    (SELECT admin_user_id FROM inserted_user) AS admin_user_id;
