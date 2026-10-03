#!/bin/sh
set -eu

config=/run/secrets/seaweed_s3_config
if ! test -s "$config" || ! grep -Eq '^\{"identities":\[\{"name":"vetchium-hub-media","credentials":\[\{"accessKey":"[A-Za-z0-9]{16,}","secretKey":"[A-Za-z0-9]{32,}"\}\],"actions":\["Admin:hub-profile-pictures","Read:hub-profile-pictures","List:hub-profile-pictures","Write:hub-profile-pictures","Admin:org-logos","Read:org-logos","List:org-logos","Write:org-logos"\]\}\]\}$' "$config"; then
    echo 'SeaweedFS S3 credentials are missing or unsafe' >&2
    exit 1
fi

exec /usr/bin/weed s3 -config="$config" "$@"
