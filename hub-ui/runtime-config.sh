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

output_path="${VETCHIUM_RUNTIME_CONFIG_PATH:-/tmp/vetchium-runtime-config.js}"

printf 'globalThis.__VETCHIUM_CONFIG__ = Object.freeze({ defaultLanguage: "%s", tenantId: "%s", hubPlans: Object.freeze([%s]) });\n' \
  "$language" "$tenant_id" "$hub_plans_json" > "$output_path"
