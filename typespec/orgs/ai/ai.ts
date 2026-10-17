import type { OpeningContent } from "../../common/openings.ts";
import {
  normalizeOpeningContent,
  validateOpeningContent,
} from "../../common/openings.ts";
import {
  isPageSize,
  isPaginationKey,
  type PageSize,
  type PaginationKey,
} from "../../common/pagination.ts";
import {
  type AICreditBalance,
  type AICreditLot,
  type AICreditPack,
  type AICreditPackID,
  type AIModel,
  type AIModelOID,
  type AIOperation,
  type AIOperationOID,
  type AIOperationPolicy,
  type AIUsage,
  type AIUsageID,
  isAICreditPackID,
  isAIModelOID,
  isAIOperation,
  isAIUsageID,
  validateAIOperationPolicy,
} from "./types.ts";

/** The AI terms version the portal shows. Enabling AI accepts exactly this
 * version; changing the terms text means a new version. */
export const OrgAITermsVersion = "ai-2026-10";

export const MaxDraftInstructionLength = 4000;
export const MaxPolicies = 10;

export interface GetAIOptionsRequest {
  operation: AIOperation;
}

export function validateGetAIOptionsRequest(
  request: GetAIOptionsRequest,
): string[] {
  return isAIOperation(request.operation) ? [] : ["operation"];
}

export type AIAvailability =
  | "ready"
  | "not_enabled"
  | "operation_off"
  | "plan_required"
  | "no_credits";

export interface AIOptions {
  availability: AIAvailability;
  models: AIModel[];
  default_model?: AIModelOID;
  balance_available: number;
}

export interface AIOperationDefault {
  operation: AIOperationOID;
  default_model: AIModelOID;
}

export interface OrgAISettings {
  enabled: boolean;
  accepted_terms_version?: string;
  accepted_terms_at?: string;
  policies: AIOperationPolicy[];
}

export interface AISettingsResponse {
  settings: OrgAISettings;
  models: AIModel[];
  operation_defaults: AIOperationDefault[];
  current_terms_version: string;
  plan_allows_ai: boolean;
  unavailable_models: AIModelOID[];
}

export interface SetAISettingsRequest {
  enabled: boolean;
  accept_terms_version?: string;
  policies: AIOperationPolicy[];
}

export function validateSetAISettingsRequest(
  request: SetAISettingsRequest,
): string[] {
  const fields: string[] = [];
  if (request.accept_terms_version !== undefined) {
    const length = [...request.accept_terms_version].length;
    if (length < 1 || length > 64) fields.push("accept_terms_version");
  }
  if (request.policies.length > MaxPolicies) {
    fields.push("policies");
    return fields;
  }
  const seen = new Set<string>();
  request.policies.forEach((policy, index) => {
    const prefix = `policies.${index}.`;
    fields.push(...validateAIOperationPolicy(policy, prefix));
    if (seen.has(policy.operation)) fields.push(`${prefix}operation`);
    seen.add(policy.operation);
  });
  return fields;
}

export interface AICreditsResponse {
  balance: AICreditBalance;
  monthly_grant: number;
  purchase_allowed: boolean;
  packs: AICreditPack[];
}

export interface ListAICreditLotsRequest {
  pagination_key?: PaginationKey;
  limit?: PageSize;
}

export interface ListAICreditLotsResponse {
  lots: AICreditLot[];
  next_pagination_key?: PaginationKey;
}

export function validateListAICreditLotsRequest(
  request: ListAICreditLotsRequest,
): string[] {
  return validatePage(request.pagination_key, request.limit);
}

export interface BuyAICreditPackRequest {
  pack_id: AICreditPackID;
}

export function validateBuyAICreditPackRequest(
  request: BuyAICreditPackRequest,
): string[] {
  return isAICreditPackID(request.pack_id) ? [] : ["pack_id"];
}

export interface ListAIUsageRequest {
  pagination_key?: PaginationKey;
  limit?: PageSize;
}

export interface ListAIUsageResponse {
  entries: AIUsage[];
  next_pagination_key?: PaginationKey;
}

export function validateListAIUsageRequest(
  request: ListAIUsageRequest,
): string[] {
  return validatePage(request.pagination_key, request.limit);
}

export interface GetAIUsageTextRequest {
  usage_id: AIUsageID;
}

export function validateGetAIUsageTextRequest(
  request: GetAIUsageTextRequest,
): string[] {
  return isAIUsageID(request.usage_id) ? [] : ["usage_id"];
}

export interface DraftOpeningRequest {
  model_oid?: AIModelOID;
  instruction: string;
  current_content?: OpeningContent;
}

export function normalizeDraftOpeningRequest(
  request: DraftOpeningRequest,
): DraftOpeningRequest {
  return {
    ...request,
    instruction: request.instruction.trim(),
    ...(request.current_content !== undefined && {
      current_content: normalizeOpeningContent(request.current_content),
    }),
  };
}

export function validateDraftOpeningRequest(
  request: DraftOpeningRequest,
): string[] {
  const normalized = normalizeDraftOpeningRequest(request);
  const fields: string[] = [];
  if (normalized.model_oid !== undefined && !isAIModelOID(normalized.model_oid))
    fields.push("model_oid");
  const length = [...normalized.instruction].length;
  if (length < 1 || length > MaxDraftInstructionLength)
    fields.push("instruction");
  if (normalized.current_content !== undefined) {
    for (const field of validateOpeningContent(normalized.current_content))
      fields.push(`current_content.${field}`);
  }
  return fields;
}

export interface AIUsageCharge {
  usage_id: AIUsageID;
  model_oid: AIModelOID;
  input_tokens: number;
  output_tokens: number;
  credits_charged: number;
}

export interface DraftOpeningResponse {
  content: OpeningContent;
  dropped_fields: string[];
  usage: AIUsageCharge;
  balance_available: number;
}

function validatePage(
  key: PaginationKey | undefined,
  limit: PageSize | undefined,
): string[] {
  const fields: string[] = [];
  if (key !== undefined && !isPaginationKey(key)) fields.push("pagination_key");
  if (limit !== undefined && !isPageSize(limit)) fields.push("limit");
  return fields;
}
