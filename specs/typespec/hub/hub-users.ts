import {
	type EmailAddress,
	type Password,
	type ValidationError,
	newValidationError,
	validateEmailAddress,
	validatePassword,
} from "../common/common";

export type { EmailAddress, Password, ValidationError };

export interface HubLoginRequest {
	email_address: EmailAddress;
	password: Password;
}

export function validateHubLoginRequest(request: HubLoginRequest): ValidationError[] {
	const errs: ValidationError[] = [];

	const emailErr = validateEmailAddress(request.email_address);
	if (emailErr) {
		errs.push(newValidationError("email_address", emailErr));
	}

	const passwordErr = validatePassword(request.password);
	if (passwordErr) {
		errs.push(newValidationError("password", passwordErr));
	}

	return errs;
}

export interface HubLoginResponse {
	token: string;
}
