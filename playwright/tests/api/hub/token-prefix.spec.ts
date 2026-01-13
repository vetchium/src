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
} from "../../../lib/db";
import {
	waitForEmail,
	getEmailContent,
	searchEmails,
	extractTfaCode,
} from "../../../lib/mailpit";
import { extractSignupTokenFromEmail } from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	RequestSignupRequest,
	CompleteSignupRequest,
	HubLoginRequest,
	HubTFARequest,
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

/**
 * Helper to get TFA token from login
 */
async function getTfaToken(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<string> {
	const loginRequest: HubLoginRequest = { email_address: email, password };
	const loginResponse = await api.login(loginRequest);
	expect(loginResponse.status).toBe(200);
	return loginResponse.body.tfa_token;
}

/**
 * Helper function to get TFA code from the most recent TFA email.
 * Uses exponential backoff to handle delays under parallel test load.
 */
async function getTfaCodeForHubUser(email: string): Promise<string> {
	const maxRetries = 15;
	let delay = 1000;
	const maxDelay = 5000;
	const backoffMultiplier = 1.5;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const messages = await searchEmails(email);

		for (const msgSummary of messages) {
			const fullMessage = await getEmailContent(msgSummary.ID);
			try {
				const code = extractTfaCode(fullMessage.Text);
				return code;
			} catch (e) {
				// This email doesn't contain a TFA code, try next one
			}
		}

		if (attempt < maxRetries) {
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay = Math.min(delay * backoffMultiplier, maxDelay);
		}
	}
	throw new Error(
		`No TFA code found in any emails for ${email} after ${maxRetries} attempts`
	);
}

test.describe("Hub Token Prefix Validation", () => {
	test("TFA token with missing region prefix returns 400", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		// Token without prefix should fail with 400 (invalid format)
		const tfaRequest: HubTFARequest = {
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "123456",
			remember_me: false,
		};
		const response = await api.verifyTFA(tfaRequest);

		expect(response.status).toBe(400);
	});

	test("TFA token with invalid region prefix returns 400", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		// Token with unknown region XXX should fail with 400 (invalid region)
		const tfaRequest: HubTFARequest = {
			tfa_token:
				"XXX1-0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "123456",
			remember_me: false,
		};
		const response = await api.verifyTFA(tfaRequest);

		expect(response.status).toBe(400);
	});

	test("TFA token with lowercase region prefix works", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			await createHubUserViaSignup(api, email, password);
			const tfaToken = await getTfaToken(api, email, password);

			// Extract the hex part and create lowercase version
			const parts = tfaToken.split("-");
			expect(parts.length).toBe(2);
			const lowercaseToken = `${parts[0].toLowerCase()}-${parts[1]}`;

			// Get TFA code
			const tfaCode = await getTfaCodeForHubUser(email);

			// Try with lowercase prefix - should work
			const tfaRequest: HubTFARequest = {
				tfa_token: lowercaseToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const response = await api.verifyTFA(tfaRequest);

			expect(response.status).toBe(200);
			expect(response.body.session_token).toBeDefined();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("TFA token with wrong region prefix returns 401", async ({
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
			const tfaToken = await getTfaToken(api, email, password);

			// User signed up in IND1, extract hex part
			const parts = tfaToken.split("-");
			expect(parts.length).toBe(2);

			// Try with USA1 prefix instead of IND1 (wrong region)
			const wrongRegionToken = `USA1-${parts[1]}`;

			// Get TFA code
			const tfaCode = await getTfaCodeForHubUser(email);

			// Try with wrong region - should fail
			const tfaRequest: HubTFARequest = {
				tfa_token: wrongRegionToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const response = await api.verifyTFA(tfaRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("Session token with missing region prefix returns 401", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		// Session token without prefix should fail
		const response = await api.setLanguageRaw(
			"0000000000000000000000000000000000000000000000000000000000000000",
			{
				language: "de-DE",
			}
		);

		expect(response.status).toBe(401);
	});

	test("Session token with invalid region prefix returns 401", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		// Session token with unknown region should fail
		const response = await api.setLanguageRaw(
			"XXX1-0000000000000000000000000000000000000000000000000000000000000000",
			{
				language: "de-DE",
			}
		);

		expect(response.status).toBe(401);
	});

	test("Session token with wrong region prefix returns 401", async ({
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
			const tfaToken = await getTfaToken(api, email, password);

			// Get TFA code and create session
			const tfaCode = await getTfaCodeForHubUser(email);

			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Extract hex part and use wrong region
			const parts = sessionToken.split("-");
			expect(parts.length).toBe(2);

			// User is in IND1, try with USA1
			const wrongRegionToken = `USA1-${parts[1]}`;

			// Try to use session with wrong region
			const response = await api.setLanguageRaw(wrongRegionToken, {
				language: "de-DE",
			});

			expect(response.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("TFA and session tokens have matching region prefixes", async ({
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
			const tfaToken = await getTfaToken(api, email, password);

			// TFA token should have IND1 prefix (signup region)
			expect(tfaToken).toMatch(/^IND1-[a-f0-9]{64}$/);

			// Get TFA code and create session
			const tfaCode = await getTfaCodeForHubUser(email);

			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Session token should also have IND1 prefix
			expect(sessionToken).toMatch(/^IND1-[a-f0-9]{64}$/);

			// Extract prefixes to verify they match
			const tfaParts = tfaToken.split("-");
			const sessionParts = sessionToken.split("-");

			expect(tfaParts[0]).toBe(sessionParts[0]);
			expect(tfaParts[0]).toBe("IND1");
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
