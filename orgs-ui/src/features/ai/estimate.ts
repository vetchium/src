import type { OpeningContent } from "typespec/common/openings";
import type { AIModel } from "typespec/orgs/ai/types";

// The instructions and Org context the server adds to every drafting prompt,
// in characters, and a typical draft's length in tokens, as measured with the
// development models (Qwen3 1.7B wrote about 280 tokens, Ministral 3 3B about
// 475). The estimate is a guide only; the API reserves the worst case and
// charges the tokens actually used.
const instructionChars = 1750;
const typicalOutputTokens = 400;

function cost(model: AIModel, input: number, output: number): number {
  return Math.ceil(
    (input * model.input_credits_per_million_tokens +
      output * model.output_credits_per_million_tokens) /
      1_000_000,
  );
}

/** About how many credits a draft costs with this model. */
export function estimateDraftCredits(
  model: AIModel,
  instruction: string,
  current: OpeningContent,
): number {
  const promptChars =
    instructionChars + instruction.length + JSON.stringify(current).length;
  return Math.max(
    cost(model, Math.ceil(promptChars / 4), typicalOutputTokens),
    1,
  );
}

// A typical request: a sentence or two describing the role.
const typicalInstruction = "x".repeat(300);

/** About how many credits a typical new draft costs with this model. */
export function typicalDraftCredits(model: AIModel): number {
  return estimateDraftCredits(model, typicalInstruction, {});
}
