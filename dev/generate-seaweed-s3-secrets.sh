#!/bin/sh
set -eu

secret_dir=$1
shift
umask 077

for tenant do
    access_file="$secret_dir/seaweed_s3_${tenant}_access_key"
    secret_file="$secret_dir/seaweed_s3_${tenant}_secret_key"
    config_file="$secret_dir/seaweed_s3_${tenant}_config"

    if test -e "$access_file" || test -e "$secret_file" || test -e "$config_file"; then
        if ! test -s "$access_file" || ! test -s "$secret_file" ||
            ! test -s "$config_file" ||
            ! grep -Fq "\"accessKey\":\"$(cat "$access_file")\"" "$config_file" ||
            ! grep -Fq "\"secretKey\":\"$(cat "$secret_file")\"" "$config_file"; then
            echo "incomplete or inconsistent $tenant SeaweedFS S3 secrets" >&2
            exit 1
        fi
        continue
    fi

    access_key=$(openssl rand -hex 16)
    secret_key=$(openssl rand -hex 32)
    printf '%s' "$access_key" > "$access_file"
    printf '%s' "$secret_key" > "$secret_file"
    printf '{"identities":[{"name":"vetchium-hub-media","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin:hub-profile-pictures","Read:hub-profile-pictures","List:hub-profile-pictures","Write:hub-profile-pictures","Admin:org-logos","Read:org-logos","List:org-logos","Write:org-logos"]}]}' \
        "$access_key" "$secret_key" > "$config_file"
done
