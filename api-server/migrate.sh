#!/bin/sh
set -e

echo "Running global database migrations..."
migrate -path /migrations/global -database "$GLOBAL_DB_URL" up

echo "Running regional database migrations for IND1..."
migrate -path /migrations/regional -database "$REGIONAL_DB_IND1_URL" up

echo "Running regional database migrations for USA1..."
migrate -path /migrations/regional -database "$REGIONAL_DB_USA1_URL" up

echo "Running regional database migrations for DEU1..."
migrate -path /migrations/regional -database "$REGIONAL_DB_DEU1_URL" up

echo "All migrations completed successfully!"
