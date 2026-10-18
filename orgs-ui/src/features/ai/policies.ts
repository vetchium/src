import type { AISettingsResponse } from "typespec/orgs/ai/ai";
import type { AIOperationPolicy } from "typespec/orgs/ai/types";

/**
 * The stored policies as the API applies them now, so a save resends what
 * the Org already has and never widens it. A model the region no longer
 * offers would refuse the whole save, so it is dropped; a withdrawn default
 * gives way to the region default, which joins the allowed models. A policy
 * that is off stays off.
 */
export function resendablePolicies(
  settings: AISettingsResponse,
): AIOperationPolicy[] {
  const offered = new Set(settings.models.map((model) => model.model_oid));
  return settings.settings.policies.map((policy) => {
    if (policy.allowed_models.length === 0) return policy;
    const allowed = policy.allowed_models.filter((oid) => offered.has(oid));
    if (
      policy.default_model !== undefined &&
      offered.has(policy.default_model)
    ) {
      return { ...policy, allowed_models: allowed };
    }
    const fallback =
      settings.operation_defaults.find(
        (entry) => entry.operation === policy.operation,
      )?.default_model ?? allowed[0];
    if (fallback === undefined) {
      return { operation: policy.operation, allowed_models: [] };
    }
    return {
      operation: policy.operation,
      allowed_models: allowed.includes(fallback)
        ? allowed
        : [...allowed, fallback],
      default_model: fallback,
    };
  });
}
