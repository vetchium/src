import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
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

/**
 * Helper function to create a hub user via signup and return session token.
 */
async function createHubUserAndGetSession(
	api: HubAPIClient,
	emailPrefix: string
): Promise<{ email: string; adminEmail: string; domain: string; sessionToken: string }> {
	const adminEmail = generateTestEmail("admin");
	const domain = generateTestDomainName();
	const email = `${emailPrefix}-${randomUUID().substring(0, 8)}@${domain}`;
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

	return { email, adminEmail, domain, sessionToken: tfaResponse.body.session_token };
}

test.describe("POST /hub/logout", () => {
	test("successful logout returns 200", async ({ request }) => {
		const api = new HubAPIClient(request);
		const { email, adminEmail, domain, sessionToken } =
			await createHubUserAndGetSession(api, "hub-logout-success");

		try {
			const response = await api.logout(sessionToken);

			expect(response.status).toBe(200);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("logout invalidates session token", async ({ request }) => {
		const api = new HubAPIClient(request);
		const { email, adminEmail, domain, sessionToken } =
			await createHubUserAndGetSession(api, "hub-logout-invalid");

		try {
			// First logout should succeed
			const response1 = await api.logout(sessionToken);
			expect(response1.status).toBe(200);

			// Second logout with same token should fail (token invalidated)
			const response2 = await api.logout(sessionToken);
			expect(response2.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("logout without Authorization header returns 401", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		const response = await api.logoutWithoutAuth();

		expect(response.status).toBe(401);
	});

	test("logout with invalid session token returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);

		// Use a fake session token with region prefix
		const fakeToken = "IND1-" + "a".repeat(64);
		const response = await api.logout(fakeToken);

		expect(response.status).toBe(401);
	});

	test("logout with malformed session token returns 401", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		// Use a malformed token without proper region prefix
		const response = await api.logout("invalid-token");

		expect(response.status).toBe(401);
	});
});
