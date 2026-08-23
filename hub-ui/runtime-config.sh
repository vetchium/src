#!/bin/sh
set -eu

language="${VETCHIUM_DEFAULT_LANGUAGE:-en-US}"
case "$language" in
  en-US|ta|de_DE) ;;
  *)
    echo "VETCHIUM_DEFAULT_LANGUAGE must be en-US, ta, or de_DE" >&2
    exit 1
    ;;
esac

printf 'globalThis.__VETCHIUM_CONFIG__ = Object.freeze({ defaultLanguage: "%s" });\n' \
  "$language" > /tmp/vetchium-runtime-config.js
