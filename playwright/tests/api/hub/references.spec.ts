import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	deleteTestHubUser,
	generateTestEmail,
	generateTestDomainName,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
	extractSignupTokenFromEmail,
} from "../../../lib/db";
import {
	waitForEmail,
	getEmailContent,
	getTfaCodeFromEmail,
	deleteEmailsFor,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	HubLoginRequest,
	HubTFARequest,
	RequestSignupRequest,
	CompleteSignupRequest,
} from "vetchium-specs/hub/hub-users";
import type { ListReferenceRequestsIncomingRequest } from "vetchium-specs/hub/references";

/**
 * Helper function to create a hub user via signup and return session token.
 */
async function createHubUserAndGetSession(
	api: HubAPIClient,
	emailPrefix: string
): Promise<{
	email: string;
	adminEmail: string;
	domain: string;
	sessionToken: string;
}> {
	const adminEmail = generateTestEmail("admin");
	const domain = generateTestDomainName();
	const email = `${emailPrefix}@${domain}`;
	const password = TEST_PASSWORD;

	await createTestAdminUser(adminEmail, TEST_PASSWORD);
	await createTestApprovedDomain(domain, adminEmail);

	// Signup flow
	const requestSignup: RequestSignupRequest = { email_address: email };
	await api.requestSignup(requestSignup);

	const emailSummary = await waitForEmail(email);
	const emailMessage = await getEmailContent(emailSummary.ID);
	const signupToken = extractSignupTokenFromEmail(emailMessage);

	const completeSignup: CompleteSignupRequest = {
		signup_token: signupToken!,
		password,
		preferred_display_name: "Test User",
		home_region: "ind1",
		preferred_language: "en-US",
		resident_country_code: "US",
	};
	await api.completeSignup(completeSignup);

	// Clear signup emails before login to isolate TFA email
	await deleteEmailsFor(email);

	// Login to get TFA token
	const loginRequest: HubLoginRequest = {
		email_address: email,
		password,
	};
	const loginResponse = await api.login(loginRequest);
	expect(loginResponse.status).toBe(200);
	expect(loginResponse.body.tfa_token).toBeDefined();

	// Get TFA code from email and verify
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRequest: HubTFARequest = {
		tfa_token: loginResponse.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	};
	const tfaResponse = await api.verifyTFA(tfaRequest);
	expect(tfaResponse.status).toBe(200);
	expect(tfaResponse.body.session_token).toBeDefined();

	return {
		email,
		adminEmail,
		domain,
		sessionToken: tfaResponse.body.session_token,
	};
}

test.describe("Hub References API", () => {
	test("listReferenceRequestsIncoming returns 200 with empty requests for new user", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const { email, adminEmail, domain, sessionToken } =
			await createHubUserAndGetSession(api, "ref-list-empty");

		try {
			const listReq: ListReferenceRequestsIncomingRequest = {
				pagination_key: undefined,
				limit: 10,
			};
			const response = await api.listReferenceRequestsIncoming(
				sessionToken,
				listReq
			);

			expect(response.status).toBe(200);
			expect(response.body.requests).toBeDefined();
			expect(Array.isArray(response.body.requests)).toBe(true);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("listReferenceRequestsIncoming without Authorization header returns 401", async ({
		request,
	}) => {
		const listReq: ListReferenceRequestsIncomingRequest = {
			pagination_key: undefined,
			limit: 10,
		};
		const response = await request.post(
			"/hub/list-reference-requests-incoming",
			{
				data: listReq,
			}
		);

		expect(response.status()).toBe(401);
	});
});
