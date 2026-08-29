-- name: PingDatabase :one
SELECT
    gen_random_uuid()::text AS nonce,
    clock_timestamp()::timestamptz AS database_time;
