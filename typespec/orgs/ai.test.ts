import assert from "node:assert/strict";
import test from "node:test";

import {
  MaxDraftInstructionLength,
  OrgAITermsVersion,
  validateBuyAICreditPackRequest,
  validateDraftOpeningRequest,
  validateGetAIUsageTextRequest,
  validateSetAISettingsRequest,
} from "./ai/ai.ts";
import { isAIModelOID, OpeningDraft } from "./ai/types.ts";

test("drafting requests validate instruction, model, and current content", () => {
  assert.deepEqual(validateDraftOpeningRequest({ instruction: " Write " }), []);
  assert.deepEqual(validateDraftOpeningRequest({ instruction: "  " }), [
    "instruction",
  ]);
  assert.deepEqual(
    validateDraftOpeningRequest({
      instruction: "é".repeat(MaxDraftInstructionLength),
    }),
    [],
  );
  assert.deepEqual(
    validateDraftOpeningRequest({
      instruction: "é".repeat(MaxDraftInstructionLength + 1),
    }),
    ["instruction"],
  );
  assert.deepEqual(
    validateDraftOpeningRequest({ instruction: "x", model_oid: "Qwen 3" }),
    ["model_oid"],
  );
  assert.deepEqual(
    validateDraftOpeningRequest({
      instruction: "x",
      current_content: { positions: 11 },
    }),
    ["current_content.positions"],
  );
});

test("settings requests validate terms and policies like the Go companion", () => {
  const policy = {
    operation: OpeningDraft,
    allowed_models: ["qwen3-1-7b", "ministral-3-3b"],
    default_model: "qwen3-1-7b",
  };
  assert.deepEqual(
    validateSetAISettingsRequest({
      enabled: true,
      accept_terms_version: OrgAITermsVersion,
      policies: [policy],
    }),
    [],
  );
  assert.deepEqual(
    validateSetAISettingsRequest({
      enabled: false,
      accept_terms_version: "",
      policies: [],
    }),
    ["accept_terms_version"],
  );
  assert.deepEqual(
    validateSetAISettingsRequest({
      enabled: false,
      policies: [policy, policy],
    }),
    ["policies.1.operation"],
  );
  assert.deepEqual(
    validateSetAISettingsRequest({
      enabled: false,
      policies: [{ ...policy, default_model: "other" }],
    }),
    ["policies.0.default_model"],
  );
  assert.deepEqual(
    validateSetAISettingsRequest({
      enabled: false,
      policies: [{ ...policy, operation: "org-future" }],
    }),
    ["policies.0.operation"],
  );
  // No allowed model turns the operation off, and then no default is allowed.
  assert.deepEqual(
    validateSetAISettingsRequest({
      enabled: false,
      policies: [{ operation: OpeningDraft, allowed_models: [] }],
    }),
    [],
  );
  assert.deepEqual(
    validateSetAISettingsRequest({
      enabled: false,
      policies: [{ ...policy, allowed_models: [] }],
    }),
    ["policies.0.default_model"],
  );
});

test("identifiers are lowercase slugs and UUIDs", () => {
  assert.ok(isAIModelOID("ministral-3-3b"));
  assert.ok(!isAIModelOID("a--b"));
  assert.deepEqual(validateBuyAICreditPackRequest({ pack_id: "Pack" }), [
    "pack_id",
  ]);
  assert.deepEqual(
    validateGetAIUsageTextRequest({
      usage_id: "0192f0c2-6a1e-7c3d-8e4f-0123456789ab",
    }),
    [],
  );
  assert.deepEqual(validateGetAIUsageTextRequest({ usage_id: "x" }), [
    "usage_id",
  ]);
});
