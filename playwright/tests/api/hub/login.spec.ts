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
	updateTestHubUserStatus,
} from "../../../lib/db";
import {
	waitForEmail,
	getEmailContent,
	getTfaCodeFromEmail,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	HubLoginRequest,
	RequestSignupRequest,
	CompleteSignupRequest,
} from "vetchium-specs/hub/hub-users";

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

test.describe("POST /hub/login", () => {
	test("successful login returns TFA token and sends email", async ({
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

			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(200);
			expect(response.body.tfa_token).toBeDefined();
			expect(response.body.tfa_token).toMatch(/^[A-Z]{3}\d-[a-f0-9]{64}$/);

			// Verify TFA email was sent
			const emailMessage = await waitForEmail(email);
			expect(emailMessage).toBeDefined();
			expect(emailMessage.To[0].Address).toBe(email);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("login with wrong password returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			await createHubUserViaSignup(api, email, password);

			const loginRequest: HubLoginRequest = {
				email_address: email,
				password: "WrongPassword456!",
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("login with non-existent email returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);

		const loginRequest: HubLoginRequest = {
			email_address: `nonexistent-${randomUUID()}@example.com`,
			password: TEST_PASSWORD,
		};
		const response = await api.login(loginRequest);

		expect(response.status).toBe(401);
	});

	test("login with disabled account returns 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			await createHubUserViaSignup(api, email, password);
			await updateTestHubUserStatus(email, "disabled");

			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(422);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("missing email_address returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.loginRaw({
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("missing password returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.loginRaw({
			email_address: "user@example.com",
		});

		expect(response.status).toBe(400);
	});

	test("empty email_address returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.loginRaw({
			email_address: "",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("empty password returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.loginRaw({
			email_address: "user@example.com",
			password: "",
		});

		expect(response.status).toBe(400);
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.loginRaw({
			email_address: "not-an-email",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("password too short returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.loginRaw({
			email_address: "user@example.com",
			password: "Short1$",
		});

		expect(response.status).toBe(400);
	});
});
