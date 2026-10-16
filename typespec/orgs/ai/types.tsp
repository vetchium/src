import "@typespec/openapi";
import "../../common/common.tsp";

namespace Vetchium.Orgs.AI;

/**
 * A model a region offers, named by Vetchium rather than by the server that
 * hosts it, so a host can change without renaming the model.
 */
@format("vetchium-ai-model-oid")
@minLength(1)
@maxLength(64)
@pattern("^[a-z0-9]+(-[a-z0-9]+)*$")
scalar AIModelOID extends string;

/** AI operations this contract version defines. */
enum AIOperation {
  OpeningDraft: "org-opening-draft",
}

/** An extensible operation identifier returned to clients. */
@format("vetchium-org-ai-operation")
@TypeSpec.OpenAPI.extension("x-vetchium-known-values", #["org-opening-draft"])
scalar AIOperationOID extends string;

/** A tenant credit pack identifier. */
@minLength(1)
@maxLength(64)
@pattern("^[a-z0-9]+(-[a-z0-9]+)*$")
scalar AICreditPackID extends string;

/** A usage record identifier. */
@format("uuid")
scalar AIUsageID extends string;

enum AIModelStatus {
  Offered: "offered",

  /** Still offered until its withdrawal date. */
  Deprecated: "deprecated",
}

model AIModel {
  model_oid: AIModelOID;
  display_name: string;
  vendor: string;

  /** SPDX identifier or the name of the model's licence. */
  licence: string;

  status: AIModelStatus;

  /** Present when deprecated: when the region stops offering it. */
  withdraws_at?: utcDateTime;

  /** Credits charged per million input tokens. */
  input_credits_per_million_tokens: int64;

  /** Credits charged per million output tokens. */
  output_credits_per_million_tokens: int64;
}

/** An operation's allowed models and the one preselected for it. */
model AIOperationPolicy {
  operation: AIOperationOID;

  @minItems(1)
  @maxItems(20)
  allowed_models: AIModelOID[];

  /** One of allowed_models. */
  default_model: AIModelOID;
}

model AICreditBalance {
  /** What a new reservation may use now: usable credits minus reserved ones. */
  available: int64;

  /** This month's grant still unspent; usable only while the plan allows AI. */
  monthly_grant_remaining: int64;

  monthly_grant_expires_at?: utcDateTime;

  /** Unexpired purchased credits still unspent. */
  purchased_remaining: int64;

  /** Held by AI calls in progress. */
  reserved: int64;
}

model AICreditPack {
  pack_id: AICreditPackID;
  credits: int64;
  /** ISO 4217, the currency of the region. */
  price_currency: string;

  /** In the currency's minor unit. */
  price_amount_minor: int64;
}

enum AICreditLotKind {
  /** The plan's monthly grant; it lapses at the end of its month. */
  Grant: "grant",

  /** A purchased pack; it expires twelve months after purchase. */
  Purchase: "purchase",
}

model AICreditLot {
  kind: AICreditLotKind;
  credits_granted: int64;
  credits_remaining: int64;
  pack_id?: AICreditPackID;
  created_at: utcDateTime;
  expires_at: utcDateTime;
}

enum AIUsageState {
  /** The model call is in progress and holds its reservation. */
  Reserved: "reserved",

  /** Completed and charged. */
  Settled: "settled",

  /** Failed and charged nothing. */
  Released: "released",

  /** Never completed; released by the system, charging nothing. */
  Abandoned: "abandoned",
}

enum AIFailureReason {
  /** The model server failed, timed out, or was busy. */
  ModelFailed: "model_failed",

  /** The model's answer did not pass Vetchium's validators. */
  UnusableOutput: "unusable_output",

  /** The call never completed. */
  Abandoned: "abandoned",
}

model AIUsage {
  usage_id: AIUsageID;
  operation: AIOperationOID;
  model_oid: AIModelOID;
  actor_email: Vetchium.EmailAddress;
  state: AIUsageState;
  failure_reason?: AIFailureReason;
  input_tokens?: int32;
  output_tokens?: int32;
  credits_charged: int64;
  created_at: utcDateTime;

  /** Whether the call's prompt and output are still kept. */
  text_available: boolean;
}

enum AIMessageRole {
  System: "system",
  User: "user",
}

model AIMessage {
  role: AIMessageRole;
  content: string;
}

/** The prompt sent and the answer received, kept for the tenant's retention period. */
model AIUsageText {
  usage_id: AIUsageID;
  request_messages: AIMessage[];

  /** Absent when the model gave no answer. */
  response_text?: string;

  expires_at: utcDateTime;
}
