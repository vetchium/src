import type { OpeningContent } from "typespec/common/openings";
import type { AIModel } from "typespec/orgs/ai/types";

// The instructions the server adds to every drafting prompt, in characters,
// and a typical draft's length in tokens. The estimate is a guide only; the
// API reserves the worst case and charges the tokens actually used.
const instructionChars = 2600;
const typicalOutputTokens = 900;

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
