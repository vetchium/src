import { getApiBaseUrl } from "../config";
import type {
	RequestSignupRequest,
	RequestSignupResponse,
	CompleteSignupRequest,
	CompleteSignupResponse,
	HubLoginRequest,
	HubLoginResponse,
	GetHubSignupDetailsRequest,
	GetHubSignupDetailsResponse,
} from "vetchium-specs/hub/hub-users";
import type { ValidationError } from "vetchium-specs/common/common";
import type {
	Region,
	SupportedLanguage,
	CheckDomainRequest,
	CheckDomainResponse,
	GetRegionsResponse,
	GetSupportedLanguagesResponse,
} from "vetchium-specs/global/global";
import type {
	ListHubPlansResponse,
	SwitchHubPlanRequest,
	HubPlanResponse,
} from "vetchium-specs/hub/plans";

export interface APIResponse<T> {
	status: number;
	data?: T;
	errors?: ValidationError[];
}

/**
 * Get list of active regions
 */
export async function getRegions(): Promise<APIResponse<Region[]>> {
	const apiBaseUrl = await getApiBaseUrl();
	const response = await fetch(`${apiBaseUrl}/global/get-regions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
	});

	const status = response.status;
	if (status === 200) {
		const responseData: GetRegionsResponse = await response.json();
		return { status, data: responseData.regions };
	}

	return { status };
}

/**
 * Get list of supported languages
 */
export async function getSupportedLanguages(): Promise<
	APIResponse<SupportedLanguage[]>
> {
	const apiBaseUrl = await getApiBaseUrl();
	const response = await fetch(`${apiBaseUrl}/global/get-supported-languages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
	});

	const status = response.status;
	if (status === 200) {
		const responseData: GetSupportedLanguagesResponse = await response.json();
		return { status, data: responseData.languages };
	}

	return { status };
}

/**
 * Check if a domain is approved for signup
 */
export async function checkDomain(
	domain: string
): Promise<APIResponse<CheckDomainResponse>> {
	const apiBaseUrl = await getApiBaseUrl();
	const requestBody: CheckDomainRequest = { domain };

	const response = await fetch(`${apiBaseUrl}/global/check-domain`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody),
	});

	const status = response.status;
	if (status === 200) {
		const data = await response.json();
		return { status, data };
	}

	if (status === 400) {
		const errors = await response.json();
		return { status, errors };
	}

	return { status };
}

/**
 * Request signup verification email
 */
export async function requestSignup(
	email: string,
	homeRegion: string
): Promise<APIResponse<RequestSignupResponse>> {
	const apiBaseUrl = await getApiBaseUrl();
	const requestBody: RequestSignupRequest = {
		email_address: email,
		home_region: homeRegion,
	};

	const response = await fetch(`${apiBaseUrl}/hub/request-signup`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody),
	});

	const status = response.status;
	if (status === 200) {
		const data = await response.json();
		return { status, data };
	}

	if (status === 400) {
		const errors = await response.json();
		return { status, errors };
	}

	return { status };
}

/**
 * Get signup details (home_region) for a pending hub signup token
 */
export async function getSignupDetails(
	token: string
): Promise<APIResponse<GetHubSignupDetailsResponse>> {
	const apiBaseUrl = await getApiBaseUrl();
	const requestBody: GetHubSignupDetailsRequest = { signup_token: token };

	const response = await fetch(`${apiBaseUrl}/hub/get-signup-details`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody),
	});

	const status = response.status;
	if (status === 200) {
		const data: GetHubSignupDetailsResponse = await response.json();
		return { status, data };
	}

	if (status === 400) {
		const errors = await response.json();
		return { status, errors };
	}

	return { status };
}

/**
 * Complete signup with verification token
 */
export async function completeSignup(
	request: CompleteSignupRequest
): Promise<APIResponse<CompleteSignupResponse>> {
	const apiBaseUrl = await getApiBaseUrl();

	const response = await fetch(`${apiBaseUrl}/hub/complete-signup`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(request),
	});

	const status = response.status;
	if (status === 201) {
		const data = await response.json();
		return { status, data };
	}

	if (status === 400) {
		const errors = await response.json();
		return { status, errors };
	}

	return { status };
}

/**
 * Login with email and password
 */
export async function login(
	email: string,
	password: string
): Promise<APIResponse<HubLoginResponse>> {
	const apiBaseUrl = await getApiBaseUrl();
	const requestBody: HubLoginRequest = {
		email_address: email,
		password,
	};

	const response = await fetch(`${apiBaseUrl}/hub/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody),
	});

	const status = response.status;
	if (status === 200) {
		const data = await response.json();
		return { status, data };
	}

	if (status === 400) {
		const errors = await response.json();
		return { status, errors };
	}

	return { status };
}

/**
 * Logout with session token
 */
export async function logout(sessionToken: string): Promise<APIResponse<void>> {
	const apiBaseUrl = await getApiBaseUrl();

	const response = await fetch(`${apiBaseUrl}/hub/logout`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${sessionToken}`,
		},
	});

	return { status: response.status };
}

/**
 * List the active hub plan catalog (Spec 17)
 */
export async function listPlans(
	sessionToken: string
): Promise<APIResponse<ListHubPlansResponse>> {
	const apiBaseUrl = await getApiBaseUrl();
	const response = await fetch(`${apiBaseUrl}/hub/list-plans`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${sessionToken}`,
		},
		body: JSON.stringify({}),
	});

	const status = response.status;
	if (status === 200) {
		const data: ListHubPlansResponse = await response.json();
		return { status, data };
	}
	return { status };
}

/**
 * Switch the authenticated hub user's own plan (Spec 17, display-only)
 */
export async function switchPlan(
	sessionToken: string,
	request: SwitchHubPlanRequest
): Promise<APIResponse<HubPlanResponse>> {
	const apiBaseUrl = await getApiBaseUrl();
	const response = await fetch(`${apiBaseUrl}/hub/switch-plan`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${sessionToken}`,
		},
		body: JSON.stringify(request),
	});

	const status = response.status;
	if (status === 200) {
		const data: HubPlanResponse = await response.json();
		return { status, data };
	}
	if (status === 400) {
		const errors = await response.json();
		return { status, errors };
	}
	return { status };
}
