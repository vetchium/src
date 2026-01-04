/**
 * Token Expiry Tests for Hub API
 *
 * These tests verify that expired tokens are properly rejected.
 * IMPORTANT: These tests require the CI docker-compose configuration
 * (docker-compose-ci.json) which uses short token durations:
 * - HUB_TFA_TOKEN_EXPIRY: 15s
 * - HUB_SESSION_TOKEN_EXPIRY: 30s
 * - HUB_SIGNUP_TOKEN_EXPIRY: 30s
 *
 * Run with: docker compose -f docker-compose-ci.json up --build
 */

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
	searchEmails,
	extractTfaCode,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	RequestSignupRequest,
	CompleteSignupRequest,
	HubLoginRequest,
	HubTFARequest,
} from "vetchium-specs/hub/hub-users";

// Token expiry durations in CI environment (with buffer for test reliability)
const TFA_TOKEN_EXPIRY_MS = 15000; // 15 seconds
const SESSION_TOKEN_EXPIRY_MS = 30000; // 30 seconds
const SIGNUP_TOKEN_EXPIRY_MS = 30000; // 30 seconds
const EXPIRY_BUFFER_MS = 8000; // 8 seconds buffer for cleanup job

/**
 * Helper to wait for a specific duration
 */
async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper function to create a test hub user through signup API
 */
async function createHubUserViaSignup(
	api: HubAPIClient,
	email: string,
	password: string,
	preferredLanguage: string = "en-US"
): Promise<void> {
	// Request signup
	const requestSignup: RequestSignupRequest = { email_address: email };
	await api.requestSignup(requestSignup);

	// Get token from email
	const emailSummary = await waitForEmail(email);
	const emailMessage = await getEmailContent(emailSummary.ID);
	const signupToken = extractSignupTokenFromEmail(emailMessage);

	// Complete signup
	const completeSignup: CompleteSignupRequest = {
		signup_token: signupToken!,
		password,
		preferred_display_name: "Test User",
		home_region: "ind1",
		preferred_language: preferredLanguage,
		resident_country_code: "US",
	};
	await api.completeSignup(completeSignup);
}

/**
 * Helper function to get TFA code from the most recent TFA email.
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

test.describe("Hub Token Expiry Tests", () => {
	test.describe.configure({ timeout: 180000 }); // Increase timeout for expiry tests

	test("expired TFA token returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Login to get TFA token
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;
			expect(tfaToken).toBeDefined();

			// Get TFA code
			const tfaCode = await getTfaCodeForHubUser(email);
			expect(tfaCode).toMatch(/^\d{6}$/);

			// Wait for TFA token to expire
			await sleep(TFA_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Try to use expired TFA token
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const expiredTfaResponse = await api.verifyTFA(tfaRequest);

			// Expired token should return 401
			expect(expiredTfaResponse.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("expired session token returns 401 for authenticated endpoint", async ({
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
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Complete full login flow
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForHubUser(email);
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;
			expect(sessionToken).toBeDefined();

			// Verify session works before expiry
			const preExpiryResponse = await api.setLanguage(sessionToken, {
				language: "en-US",
			});
			expect(preExpiryResponse.status).toBe(200);

			// Wait for session token to expire
			await sleep(SESSION_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Try to use expired session token
			const postExpiryResponse = await api.setLanguage(sessionToken, {
				language: "de-DE",
			});

			// Expired session should return 401
			expect(postExpiryResponse.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("expired session token returns 401 for logout", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Complete full login flow
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForHubUser(email);
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Wait for session to expire
			await sleep(SESSION_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Try to logout with expired session
			const logoutResponse = await api.logout(sessionToken);

			// Expired session should return 401
			expect(logoutResponse.status).toBe(401);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("expired signup token returns 401 for complete-signup", async ({
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
			// Request signup
			const requestSignup: RequestSignupRequest = { email_address: email };
			const signupResponse = await api.requestSignup(requestSignup);
			expect(signupResponse.status).toBe(200);

			// Get token from email
			const emailSummary = await waitForEmail(email);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const signupToken = extractSignupTokenFromEmail(emailMessage);
			expect(signupToken).toBeDefined();

			// Wait for signup token to expire
			await sleep(SIGNUP_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Try to complete signup with expired token
			const completeSignup: CompleteSignupRequest = {
				signup_token: signupToken!,
				password,
				preferred_display_name: "Test User",
				home_region: "ind1",
				preferred_language: "en-US",
				resident_country_code: "US",
			};
			const completeResponse = await api.completeSignup(completeSignup);

			// Expired signup token should return 401
			expect(completeResponse.status).toBe(401);
		} finally {
			// No user to delete since signup was not completed
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("TFA token still valid within expiry window", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Login to get TFA token
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Get TFA code
			const tfaCode = await getTfaCodeForHubUser(email);

			// Wait for less than expiry time (half of expiry)
			await sleep(TFA_TOKEN_EXPIRY_MS / 2);

			// Token should still be valid
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.session_token).toBeDefined();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("session with remember_me has longer expiry", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = TEST_PASSWORD;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Complete full login flow with remember_me=true
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForHubUser(email);
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: true, // Use remember_me for longer session
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Wait for normal session expiry time
			await sleep(SESSION_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Session with remember_me should still be valid (60s in CI vs 30s normal)
			const response = await api.setLanguage(sessionToken, {
				language: "de-DE",
			});

			// Remember-me session should still be valid
			expect(response.status).toBe(200);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
