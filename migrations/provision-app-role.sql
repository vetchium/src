\getenv app_password APP_POSTGRES_PASSWORD

-- Role creation and password rotation are deployment concerns rather than
-- schema migrations. Keeping them here makes the same idempotent operation
-- usable by local Compose and by the production Makefile.
SELECT format('CREATE ROLE %I LOGIN', 'vetchium_app')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vetchium_app')
\gexec

SELECT format(
    'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
    'vetchium_app',
    :'app_password'
)
\gexec
