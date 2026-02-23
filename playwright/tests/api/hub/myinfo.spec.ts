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
 * Helper to perform full hub signup+login flow and return session token.
 */
async function getHubSessionToken(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<string> {
	// Clear any existing emails
	await deleteEmailsFor(email);

	const loginRequest: HubLoginRequest = {
		email_address: email,
		password,
	};
	const loginResponse = await api.login(loginRequest);
	expect(loginResponse.status).toBe(200);

	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRequest: HubTFARequest = {
		tfa_token: loginResponse.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	};
	const tfaResponse = await api.verifyTFA(tfaRequest);
	expect(tfaResponse.status).toBe(200);

	return tfaResponse.body.session_token;
}

/**
 * Helper function to create a test hub user through signup API
 */
async function createHubUserViaSignup(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<void> {
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
}

test.describe("GET /hub/myinfo", () => {
	test("returns hub user info for valid session", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			await createHubUserViaSignup(api, email, password);
			const sessionToken = await getHubSessionToken(api, email, password);

			const response = await api.getMyInfo(sessionToken);

			expect(response.status).toBe(200);
			expect(response.body.hub_user_id).toBeDefined();
			expect(response.body.handle).toBeDefined();
			expect(response.body.email_address).toBe(email);
			expect(response.body.preferred_language).toBeDefined();
			expect(Array.isArray(response.body.roles)).toBe(true);
			// hub:read_posts is assigned to every hub user at signup
			expect(response.body.roles).toContain("hub:read_posts");
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 401 for missing session token", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.getMyInfoWithoutAuth();

		expect(response.status).toBe(401);
	});

	test("returns 401 for invalid session token", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.getMyInfo(
			"0000000000000000000000000000000000000000000000000000000000000000"
		);

		expect(response.status).toBe(401);
	});

	test("returns 401 for expired (logged-out) session token", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			await createHubUserViaSignup(api, email, password);
			const sessionToken = await getHubSessionToken(api, email, password);

			// Logout to invalidate the session
			const logoutResponse = await api.logout(sessionToken);
			expect(logoutResponse.status).toBe(200);

			// Try to use the expired token
			const response = await api.getMyInfo(sessionToken);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
