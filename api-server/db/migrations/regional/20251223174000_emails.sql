-- +goose Up
-- Email status enum
-- pending: Email is queued and waiting to be sent (including retries)
-- sent: Email was successfully delivered to SMTP server
-- failed: Email delivery permanently failed after max retry attempts
-- cancelled: Email was cancelled before delivery (e.g., TFA code expired)
CREATE TYPE email_status AS ENUM (
    'pending',
    'sent',
    'failed',
    'cancelled'
);

-- Email template type enum
CREATE TYPE email_template_type AS ENUM (
    'admin_tfa'
);

-- Emails table for transactional outbox pattern
CREATE TABLE emails (
    email_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_type email_template_type NOT NULL,
    email_to TEXT NOT NULL,
    email_subject TEXT NOT NULL,
    email_text_body TEXT NOT NULL,
    email_html_body TEXT NOT NULL,
    email_status email_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMP
);

-- Tracks each delivery attempt with its result
CREATE TABLE email_delivery_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id UUID NOT NULL REFERENCES emails(email_id) ON DELETE CASCADE,
    attempted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    error_message TEXT
);

-- +goose Down
DROP TABLE IF EXISTS email_delivery_attempts;
DROP TABLE IF EXISTS emails;
DROP TYPE IF EXISTS email_template_type;
DROP TYPE IF EXISTS email_status;
