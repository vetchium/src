export interface OrgHiringSettings {
	cool_off_days: number;
	allow_unsolicited_endorsements_default: boolean;
}

export interface UpdateOrgHiringSettingsRequest {
	cool_off_days: number;
	allow_unsolicited_endorsements_default?: boolean;
}

export function validateUpdateOrgHiringSettingsRequest(
	req: unknown
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.cool_off_days !== "number") {
		errors.push({ field: "cool_off_days", message: "Must be a number" });
	} else if (r.cool_off_days < 0 || r.cool_off_days > 365) {
		errors.push({
			field: "cool_off_days",
			message: "Must be between 0 and 365",
		});
	}

	if (
		r.allow_unsolicited_endorsements_default !== undefined &&
		typeof r.allow_unsolicited_endorsements_default !== "boolean"
	) {
		errors.push({
			field: "allow_unsolicited_endorsements_default",
			message: "Must be a boolean",
		});
	}

	return errors;
}

export interface ValidationError {
	field: string;
	message: string;
}
