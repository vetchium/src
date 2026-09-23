#!/bin/sh
set -eu

language="${VETCHIUM_DEFAULT_LANGUAGE:-en-US}"
case "$language" in
  en-US|ta|de-DE) ;;
  *)
    echo "VETCHIUM_DEFAULT_LANGUAGE must be a Hub portal locale: en-US, ta, or de-DE" >&2
    exit 1
    ;;
esac

tenant_id="${VETCHIUM_TENANT_ID:-}"
case "$tenant_id" in
  "")
    echo "VETCHIUM_TENANT_ID is required" >&2
    exit 1
    ;;
  *[!a-z0-9-]*|[!a-z]*)
    echo "VETCHIUM_TENANT_ID must match ^[a-z][a-z0-9-]{0,62}\$" >&2
    exit 1
    ;;
esac
if [ "${#tenant_id}" -gt 63 ]; then
  echo "VETCHIUM_TENANT_ID must match ^[a-z][a-z0-9-]{0,62}\$" >&2
  exit 1
fi

# The plan list duplicates the contract, as the locale list above already
# does. The backend config test TestCheckedInHubPlansMatchPortalConfiguration
# covers every checked-in environment file, but not this validation list, so
# adding a plan here needs a matching update by hand.
hub_plans_raw="${VETCHIUM_HUB_PLANS:-}"
if [ -z "$hub_plans_raw" ]; then
  echo "VETCHIUM_HUB_PLANS is required" >&2
  exit 1
fi
case "$hub_plans_raw" in
  ,*|*,|*,,*)
    echo "VETCHIUM_HUB_PLANS must not contain an empty item" >&2
    exit 1
    ;;
esac

old_ifs="$IFS"
IFS=','
set -f
set -- $hub_plans_raw
set +f
IFS="$old_ifs"

hub_plans_json=""
has_free_tier=0
seen=""
for plan in "$@"; do
  case "$plan" in
    "")
      echo "VETCHIUM_HUB_PLANS must not contain an empty item" >&2
      exit 1
      ;;
    hub-free-tier|hub-silver-tier) ;;
    *)
      echo "VETCHIUM_HUB_PLANS contains an unknown plan: $plan" >&2
      exit 1
      ;;
  esac
  case ",$seen," in
    *",$plan,"*)
      echo "VETCHIUM_HUB_PLANS contains a duplicate plan: $plan" >&2
      exit 1
      ;;
  esac
  seen="$seen,$plan"
  if [ "$plan" = "hub-free-tier" ]; then
    has_free_tier=1
  fi
  if [ -z "$hub_plans_json" ]; then
    hub_plans_json="\"$plan\""
  else
    hub_plans_json="$hub_plans_json, \"$plan\""
  fi
done
if [ "$has_free_tier" -ne 1 ]; then
  echo "VETCHIUM_HUB_PLANS must include hub-free-tier" >&2
  exit 1
fi

# A federated profile read renders the picture owner's HOME tenant's signed
# media URL directly in the browser (object-storage.md), so every tenant's
# hub-ui must allow every tenant's media origin in img-src, not only its own.
# This list must match every checked-in tenant's objectStorage.mediaBaseURL
# (each an http(s) origin with no path, query, fragment, or credentials, the
# same shape appconfig.httpOrigin enforces in Go), cross-checked against the
# checked-in compose and stack files by
# TestCheckedInHubPlansMatchPortalConfiguration.
media_origins_raw="${VETCHIUM_MEDIA_ORIGINS:-}"
if [ -z "$media_origins_raw" ]; then
  echo "VETCHIUM_MEDIA_ORIGINS is required" >&2
  exit 1
fi
case "$media_origins_raw" in
  ,*|*,|*,,*)
    echo "VETCHIUM_MEDIA_ORIGINS must not contain an empty item" >&2
    exit 1
    ;;
esac

old_ifs="$IFS"
IFS=','
set -f
set -- $media_origins_raw
set +f
IFS="$old_ifs"

media_origins_img_src=""
seen=""
for media_origin in "$@"; do
  case "$media_origin" in
    http://*) media_origin_host="${media_origin#http://}" ;;
    https://*) media_origin_host="${media_origin#https://}" ;;
    *)
      echo "VETCHIUM_MEDIA_ORIGINS item must start with http:// or https://: $media_origin" >&2
      exit 1
      ;;
  esac
  case "$media_origin_host" in
    ""|*/*|*'?'*|*'#'*|*@*|*' '*|*'"'*)
      echo "VETCHIUM_MEDIA_ORIGINS item must be an origin with a host and no path, query, fragment, or credentials: $media_origin" >&2
      exit 1
      ;;
  esac
  case ",$seen," in
    *",$media_origin,"*)
      echo "VETCHIUM_MEDIA_ORIGINS contains a duplicate origin: $media_origin" >&2
      exit 1
      ;;
  esac
  seen="$seen,$media_origin"
  media_origins_img_src="$media_origins_img_src $media_origin"
done

output_path="${VETCHIUM_RUNTIME_CONFIG_PATH:-/tmp/vetchium-runtime-config.js}"
csp_config_path="${VETCHIUM_CSP_CONFIG_PATH:-/tmp/vetchium-csp.conf}"

printf 'globalThis.__VETCHIUM_CONFIG__ = Object.freeze({ defaultLanguage: "%s", tenantId: "%s", hubPlans: Object.freeze([%s]) });\n' \
  "$language" "$tenant_id" "$hub_plans_json" > "$output_path"

printf "add_header Content-Security-Policy \"default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'self'; img-src 'self' data:%s; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'\" always;\n" \
  "$media_origins_img_src" > "$csp_config_path"
