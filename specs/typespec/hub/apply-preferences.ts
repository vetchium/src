export interface HubApplyPreferences {
	notify_connections_on_apply: boolean;
	allow_unsolicited_endorsements: boolean;
}

export interface SetNotifyConnectionsOnApplyRequest {
	notify_connections_on_apply: boolean;
}

export interface SetAllowUnsolicitedEndorsementsRequest {
	allow_unsolicited_endorsements: boolean;
}

export function validateSetNotifyConnectionsOnApplyRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;
	if (typeof r.notify_connections_on_apply !== "boolean") {
		errors.push({
			field: "notify_connections_on_apply",
			message: "Must be a boolean",
		});
	}
	return errors;
}

export function validateSetAllowUnsolicitedEndorsementsRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;
	if (typeof r.allow_unsolicited_endorsements !== "boolean") {
		errors.push({
			field: "allow_unsolicited_endorsements",
			message: "Must be a boolean",
		});
	}
	return errors;
}

export interface ValidationError {
	field: string;
	message: string;
}
