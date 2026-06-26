import { newValidationError, type ValidationError } from "../common/common";

// Hub plan identifiers (Spec 17). Enum union — never a bare string.
export type HubPlanId = "free" | "pro";

export const VALID_HUB_PLAN_IDS: readonly HubPlanId[] = [
	"free",
	"pro",
] as const;

export interface HubPlan {
	plan_id: HubPlanId;
	display_order: number;
	can_upload_profile_picture: boolean;
	can_post_messages: boolean;
	self_upgradeable: boolean;
}

export interface ListHubPlansRequest {}

export interface ListHubPlansResponse {
	plans: HubPlan[];
}

export interface SwitchHubPlanRequest {
	plan_id: HubPlanId;
}

export interface HubPlanResponse {
	plan_id: HubPlanId;
	can_upload_profile_picture: boolean;
	can_post_messages: boolean;
}

export function validateSwitchHubPlanRequest(
	req: SwitchHubPlanRequest
): ValidationError[] {
	const errs: ValidationError[] = [];
	// Only reject an empty plan_id (400). An unknown-but-non-empty id is left to
	// the server's DB lookup → 404 (missing) or 422 (retired/non-self-upgradeable).
	if (!req.plan_id) {
		errs.push(newValidationError("plan_id", "plan_id is required"));
	}
	return errs;
}
