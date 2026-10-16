import type { EmailAddress } from "../../common/common.ts";

export type AIModelOID = string;
export type AICreditPackID = string;
export type AIUsageID = string;

export const OpeningDraft = "org-opening-draft" as const;

export const aiOperationValues = [OpeningDraft] as const;
export type AIOperation = (typeof aiOperationValues)[number];

/** Open identifier: a newer API may return operations this portal does not
 * define yet. */
export type AIOperationOID = string;

export function isAIOperation(value: unknown): value is AIOperation {
  return (
    typeof value === "string" &&
    (aiOperationValues as readonly string[]).includes(value)
  );
}

export const MaxAllowedModels = 20;

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isAIModelOID(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && slugPattern.test(value);
}

export function isAICreditPackID(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && slugPattern.test(value);
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Accepts the lowercase form the API returns. */
export function isAIUsageID(value: string): boolean {
  return uuidPattern.test(value);
}

export type AIModelStatus = "offered" | "deprecated";

export interface AIModel {
  model_oid: AIModelOID;
  display_name: string;
  vendor: string;
  licence: string;
  status: AIModelStatus;
  withdraws_at?: string;
  input_credits_per_million_tokens: number;
  output_credits_per_million_tokens: number;
}

export interface AIOperationPolicy {
  operation: AIOperationOID;
  allowed_models: AIModelOID[];
  default_model: AIModelOID;
}

/** Reports the policy's invalid fields, prefixed for its position in a
 * request. */
export function validateAIOperationPolicy(
  policy: AIOperationPolicy,
  prefix: string,
): string[] {
  const fields: string[] = [];
  if (!isAIOperation(policy.operation)) fields.push(`${prefix}operation`);
  const models = policy.allowed_models;
  if (
    models.length < 1 ||
    models.length > MaxAllowedModels ||
    new Set(models).size !== models.length ||
    !models.every(isAIModelOID)
  )
    fields.push(`${prefix}allowed_models`);
  if (
    !isAIModelOID(policy.default_model) ||
    !models.includes(policy.default_model)
  )
    fields.push(`${prefix}default_model`);
  return fields;
}

export interface AICreditBalance {
  available: number;
  monthly_grant_remaining: number;
  monthly_grant_expires_at?: string;
  purchased_remaining: number;
  reserved: number;
}

export interface AICreditPack {
  pack_id: AICreditPackID;
  credits: number;
  price_currency: string;
  price_amount_minor: number;
}

export type AICreditLotKind = "grant" | "purchase";

export interface AICreditLot {
  kind: AICreditLotKind;
  credits_granted: number;
  credits_remaining: number;
  pack_id?: AICreditPackID;
  created_at: string;
  expires_at: string;
}

export type AIUsageState = "reserved" | "settled" | "released" | "abandoned";

export type AIFailureReason = "model_failed" | "unusable_output" | "abandoned";

export interface AIUsage {
  usage_id: AIUsageID;
  operation: AIOperationOID;
  model_oid: AIModelOID;
  actor_email: EmailAddress;
  state: AIUsageState;
  failure_reason?: AIFailureReason;
  input_tokens?: number;
  output_tokens?: number;
  credits_charged: number;
  created_at: string;
  text_available: boolean;
}

export type AIMessageRole = "system" | "user";

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

export interface AIUsageText {
  usage_id: AIUsageID;
  request_messages: AIMessage[];
  response_text?: string;
  expires_at: string;
}
