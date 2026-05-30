export interface ExtendOfferRequest {
	candidacy_id: string;
	salary_currency?: string;
	salary_amount?: number;
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

	if (r.salary_currency !== undefined) {
		if (typeof r.salary_currency !== "string") {
			errors.push({ field: "salary_currency", message: "Must be a string" });
		} else if (r.salary_currency.length > 3) {
			errors.push({
				field: "salary_currency",
				message: "Must be at most 3 characters",
			});
		}
	}

	if (r.salary_amount !== undefined) {
		if (typeof r.salary_amount !== "number" || r.salary_amount < 0) {
			errors.push({
				field: "salary_amount",
				message: "Must be a non-negative number",
			});
		}
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
