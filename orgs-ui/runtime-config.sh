#!/bin/sh
set -eu

language="${VETCHIUM_DEFAULT_LANGUAGE:-en-US}"
case "$language" in
  en-US|ta|de-DE) ;;
  *)
    echo "VETCHIUM_DEFAULT_LANGUAGE must be an Orgs portal locale: en-US, ta, or de-DE" >&2
    exit 1
    ;;
esac

output_path="${VETCHIUM_RUNTIME_CONFIG_PATH:-/tmp/vetchium-runtime-config.js}"

printf 'globalThis.__VETCHIUM_CONFIG__ = Object.freeze({ defaultLanguage: "%s" });\n' \
  "$language" > "$output_path"
