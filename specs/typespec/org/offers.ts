export interface ExtendOfferRequest {
	candidacy_id: string;
	start_date?: string;
	notes?: string;
}

export interface ValidationError {
	field: string;
	message: string;
}

export function validateExtendOfferRequest(req: unknown): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!req || typeof req !== "object") {
		return [{ field: "$root", message: "Request body is required" }];
	}
	const r = req as Record<string, unknown>;

	if (typeof r.candidacy_id !== "string" || r.candidacy_id.trim() === "") {
		errors.push({
			field: "candidacy_id",
			message: "Must be a non-empty string",
		});
	}

	if (r.start_date !== undefined) {
		if (typeof r.start_date !== "string") {
			errors.push({ field: "start_date", message: "Must be a date string" });
		}
	}

	if (r.notes !== undefined) {
		if (typeof r.notes !== "string") {
			errors.push({ field: "notes", message: "Must be a string" });
		} else if (r.notes.length > 4000) {
			errors.push({
				field: "notes",
				message: "Must be at most 4000 characters",
			});
		}
	}

	return errors;
}
