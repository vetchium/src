import { APIRequestContext } from "@playwright/test";
import type {
	GetRegionsResponse,
	GetSupportedLanguagesResponse,
	CheckDomainRequest,
	CheckDomainResponse,
} from "vetchium-specs/global/global";
import type { APIResponse } from "./api-client";

/**
 * Global API client for platform-wide public endpoints.
 * These endpoints are accessible to all portals (Hub, Org, Agency).
 */
export class GlobalAPIClient {
	constructor(private request: APIRequestContext) {}

	/**
	 * POST /global/get-regions
	 * Returns list of active regions for dropdown
	 */
	async getRegions(): Promise<APIResponse<GetRegionsResponse>> {
		const response = await this.request.post("/global/get-regions", {
			data: {},
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as GetRegionsResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /global/get-supported-languages
	 * Returns list of supported languages
	 */
	async getSupportedLanguages(): Promise<
		APIResponse<GetSupportedLanguagesResponse>
	> {
		const response = await this.request.post(
			"/global/get-supported-languages",
			{
				data: {},
			}
		);

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as GetSupportedLanguagesResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /global/check-domain
	 * Checks if a domain is approved for signup
	 */
	async checkDomain(
		request: CheckDomainRequest
	): Promise<APIResponse<CheckDomainResponse>> {
		const response = await this.request.post("/global/check-domain", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as CheckDomainResponse,
			errors: body.errors,
		};
	}

	/**
	 * POST /global/check-domain with raw body for testing invalid payloads
	 */
	async checkDomainRaw(
		body: unknown
	): Promise<APIResponse<CheckDomainResponse>> {
		const response = await this.request.post("/global/check-domain", {
			data: body,
		});

		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as CheckDomainResponse,
			errors: responseBody.errors,
		};
	}
}
