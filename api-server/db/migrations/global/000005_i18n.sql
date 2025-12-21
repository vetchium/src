-- +goose Up

-- Supported languages table for UI dropdowns
-- Stores officially supported languages that users can select
CREATE TABLE supported_languages (
    language_code TEXT PRIMARY KEY,           -- BCP 47 tag: 'en-US', 'de-DE', 'ta-IN'
    language_name TEXT NOT NULL,              -- Display name: 'English (United States)'
    native_name TEXT NOT NULL,                -- Native name: 'English', 'Deutsch', 'தமிழ்'
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Ensure only one default language
CREATE UNIQUE INDEX idx_supported_languages_default
ON supported_languages (is_default)
WHERE is_default = TRUE;

-- Initial supported languages
INSERT INTO supported_languages (language_code, language_name, native_name, is_default) VALUES
    ('en-US', 'English (United States)', 'English', TRUE),
    ('de-DE', 'German (Germany)', 'Deutsch', FALSE),
    ('ta-IN', 'Tamil (India)', 'தமிழ்', FALSE);

-- Add preferred_language to admin_users
-- No foreign key constraint: allows storing user preference even if language not yet supported
ALTER TABLE admin_users
ADD COLUMN preferred_language TEXT NOT NULL DEFAULT 'en-US';

-- Migrate hub_users.preferred_language from enum to TEXT for BCP 47 flexibility
ALTER TABLE hub_users
ALTER COLUMN preferred_language TYPE TEXT
USING CASE preferred_language::TEXT
    WHEN 'en' THEN 'en-US'
    WHEN 'de' THEN 'de-DE'
    WHEN 'hi' THEN 'hi-IN'
    WHEN 'ta' THEN 'ta-IN'
END;

ALTER TABLE hub_users
ALTER COLUMN preferred_language SET DEFAULT 'en-US';

-- Drop the old enum type
DROP TYPE language;

-- +goose Down

-- Recreate the language enum
CREATE TYPE language AS ENUM ('en', 'de', 'hi', 'ta');

-- Revert hub_users.preferred_language to enum
ALTER TABLE hub_users
ALTER COLUMN preferred_language SET DEFAULT 'en';

ALTER TABLE hub_users
ALTER COLUMN preferred_language TYPE language
USING CASE preferred_language
    WHEN 'en-US' THEN 'en'::language
    WHEN 'de-DE' THEN 'de'::language
    WHEN 'hi-IN' THEN 'hi'::language
    WHEN 'ta-IN' THEN 'ta'::language
    ELSE 'en'::language
END;

-- Remove preferred_language from admin_users
ALTER TABLE admin_users DROP COLUMN preferred_language;

-- Drop supported_languages table
DROP INDEX IF EXISTS idx_supported_languages_default;
DROP TABLE IF EXISTS supported_languages;
