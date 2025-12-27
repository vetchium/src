import {
	type DomainName,
	type ValidationError,
	newValidationError,
	validateDomainName,
} from "../common/common";

export type { DomainName, ValidationError };

// Interfaces
export interface Region {
	region_code: string;
	region_name: string;
}

export interface SupportedLanguage {
	language_code: string;
	language_name: string;
	native_name: string;
	is_default: boolean;
}

export interface CheckDomainRequest {
	domain: DomainName;
}

export interface CheckDomainResponse {
	is_approved: boolean;
}

export interface GetRegionsResponse {
	regions: Region[];
}

export interface GetSupportedLanguagesResponse {
	languages: SupportedLanguage[];
}

// Request validators

export function validateCheckDomainRequest(
	request: CheckDomainRequest,
): ValidationError[] {
	const errs: ValidationError[] = [];

	const domainErr = validateDomainName(request.domain);
	if (domainErr) {
		errs.push(newValidationError("domain", domainErr));
	}

	return errs;
}
