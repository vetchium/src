import type { ValidationError } from "../common/common";
import { newValidationError } from "../common/common";
import type { Handle } from "../hub/hub-users";
import type { HubProfilePublicView } from "../hub/profile";
import type { PublicEmployerStint } from "../hub/work-emails";

export interface OrgGetHubUserProfileRequest {
	handle: Handle;
}

export interface OrgHubUserProfileResponse {
	profile: HubProfilePublicView;
	stints: PublicEmployerStint[];
}

export function validateOrgGetHubUserProfileRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;
	if (!r.handle || typeof r.handle !== "string" || r.handle.trim() === "") {
		errors.push(newValidationError("handle", "Handle is required"));
	}
	return errors;
}
