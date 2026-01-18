/**
 * Token Expiry Tests for Org (Employer) API
 *
 * These tests verify that expired tokens are properly rejected.
 * IMPORTANT: These tests require the CI docker-compose configuration
 * (docker-compose-ci.json) which uses short token durations:
 * - ORG_TFA_TOKEN_EXPIRY: 15s
 * - ORG_SESSION_TOKEN_EXPIRY: 30s
 * - ORG_SIGNUP_TOKEN_EXPIRY: 30s
 * - ORG_REMEMBER_ME_EXPIRY: 60s
 *
 * Run with: docker compose -f docker-compose-ci.json up --build
 */

import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgDomain,
	deleteTestOrgDomain,
	deleteTestOrgUser,
	generateTestEmail,
	generateTestDomainName,
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
	InitSignupRequest,
	CompleteSignupRequest,
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";

// Token expiry durations in CI environment (with buffer for test reliability)
const TFA_TOKEN_EXPIRY_MS = 15000; // 15 seconds
const SESSION_TOKEN_EXPIRY_MS = 30000; // 30 seconds
const SIGNUP_TOKEN_EXPIRY_MS = 30000; // 30 seconds
const REMEMBER_ME_EXPIRY_MS = 60000; // 60 seconds
const EXPIRY_BUFFER_MS = 8000; // 8 seconds buffer for cleanup job

/**
 * Helper to wait for a specific duration
 */
async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper function to get TFA code from the most recent TFA email.
 */
async function getTfaCodeForOrgUser(email: string): Promise<string> {
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
			} catch {
				// Not a TFA email, continue searching
			}
		}

		if (attempt < maxRetries) {
			await sleep(delay);
			delay = Math.min(delay * backoffMultiplier, maxDelay);
		}
	}

	throw new Error(
		`TFA code not found in emails for ${email} after ${maxRetries} retries`
	);
}

/**
 * Helper function to create an org user through signup API
 */
async function createOrgUserViaSignup(
	api: OrgAPIClient,
	domain: string,
	email: string,
	password: string
): Promise<void> {
	// Initiate signup
	const initSignupReq: InitSignupRequest = {
		domain_name: domain,
		email_address: email,
	};
	await api.initSignup(initSignupReq);

	// Get signup token from email
	const emailSummary = await waitForEmail(email);
	const emailMessage = await getEmailContent(emailSummary.ID);
	const signupToken = extractSignupTokenFromEmail(emailMessage);

	// Complete signup
	const completeSignupReq: CompleteSignupRequest = {
		signup_token: signupToken!,
		password,
		preferred_display_name: "Test Org User",
		home_region: "ind1",
		preferred_language: "en-US",
	};
	await api.completeSignup(completeSignupReq);
}

test.describe("Org Token Expiry Tests", () => {
	test.describe.configure({ timeout: 120000 }); // Increase timeout for expiry tests

	test("expired TFA token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domain = generateTestDomainName();
		const email = generateTestEmail("org-tfa-expiry");
		const password = TEST_PASSWORD;

		await createTestOrgDomain(domain);
		try {
			// Create user via signup flow
			await createOrgUserViaSignup(api, domain, email, password);

			// Step 1: Login to get TFA token
			const loginReq: OrgLoginRequest = { email_address: email, password };
			const loginResponse = await api.login(loginReq);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;
			expect(tfaToken).toBeDefined();

			// Step 2: Get TFA code from email
			const tfaCode = await getTfaCodeForOrgUser(email);
			expect(tfaCode).toMatch(/^\d{6}$/);

			// Step 3: Wait for TFA token to expire
			await sleep(TFA_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Step 4: Try to use expired TFA token
			const tfaReq: OrgTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const expiredTfaResponse = await api.verifyTFA(tfaReq);

			// Expired token should return 401
			expect(expiredTfaResponse.status).toBe(401);
		} finally {
			await deleteTestOrgUser(email);
			await deleteTestOrgDomain(domain);
		}
	});

	test("expired session token returns 401 for authenticated endpoint", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const domain = generateTestDomainName();
		const email = generateTestEmail("org-session-expiry");
		const password = TEST_PASSWORD;

		await createTestOrgDomain(domain);
		try {
			// Create user and complete full login flow
			await createOrgUserViaSignup(api, domain, email, password);

			const loginReq: OrgLoginRequest = { email_address: email, password };
			const loginResponse = await api.login(loginReq);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForOrgUser(email);
			const tfaReq: OrgTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaReq);
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;
			expect(sessionToken).toBeDefined();

			// Step 2: Verify session works before expiry (test with getDomainStatus)
			const preExpiryResponse = await api.getDomainStatus(sessionToken, {
				domain_name: domain,
			});
			expect(preExpiryResponse.status).toBe(200);

			// Step 3: Wait for session token to expire
			await sleep(SESSION_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Step 4: Try to use expired session token
			const postExpiryResponse = await api.getDomainStatus(sessionToken, {
				domain_name: domain,
			});

			// Expired session should return 401
			expect(postExpiryResponse.status).toBe(401);
		} finally {
			await deleteTestOrgUser(email);
			await deleteTestOrgDomain(domain);
		}
	});

	test("expired session token returns 401 for logout", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domain = generateTestDomainName();
		const email = generateTestEmail("org-logout-expiry");
		const password = TEST_PASSWORD;

		await createTestOrgDomain(domain);
		try {
			// Create user and complete full login flow
			await createOrgUserViaSignup(api, domain, email, password);

			const loginReq: OrgLoginRequest = { email_address: email, password };
			const loginResponse = await api.login(loginReq);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForOrgUser(email);
			const tfaReq: OrgTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaReq);
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Wait for session to expire
			await sleep(SESSION_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Try to logout with expired session
			const logoutResponse = await api.logout(sessionToken);

			// Expired session should return 401
			expect(logoutResponse.status).toBe(401);
		} finally {
			await deleteTestOrgUser(email);
			await deleteTestOrgDomain(domain);
		}
	});

	test("TFA token still valid within expiry window", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domain = generateTestDomainName();
		const email = generateTestEmail("org-tfa-valid");
		const password = TEST_PASSWORD;

		await createTestOrgDomain(domain);
		try {
			// Create user
			await createOrgUserViaSignup(api, domain, email, password);

			// Login to get TFA token
			const loginReq: OrgLoginRequest = { email_address: email, password };
			const loginResponse = await api.login(loginReq);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Get TFA code
			const tfaCode = await getTfaCodeForOrgUser(email);

			// Wait for less than expiry time (half of expiry)
			await sleep(TFA_TOKEN_EXPIRY_MS / 2);

			// Token should still be valid
			const tfaReq: OrgTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaReq);

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.session_token).toBeDefined();
		} finally {
			await deleteTestOrgUser(email);
			await deleteTestOrgDomain(domain);
		}
	});

	test("expired remember-me token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domain = generateTestDomainName();
		const email = generateTestEmail("org-remember-expiry");
		const password = TEST_PASSWORD;

		await createTestOrgDomain(domain);
		try {
			// Create user
			await createOrgUserViaSignup(api, domain, email, password);

			// Login with remember_me flag
			const loginReq: OrgLoginRequest = { email_address: email, password };
			const loginResponse = await api.login(loginReq);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForOrgUser(email);
			const tfaReq: OrgTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: true, // Request remember-me session
			};
			const tfaResponse = await api.verifyTFA(tfaReq);
			expect(tfaResponse.status).toBe(200);
			const rememberMeToken = tfaResponse.body.session_token;
			expect(rememberMeToken).toBeDefined();

			// Verify remember-me session works before expiry
			const preExpiryResponse = await api.getDomainStatus(rememberMeToken, {
				domain_name: domain,
			});
			expect(preExpiryResponse.status).toBe(200);

			// Wait for remember-me token to expire
			await sleep(REMEMBER_ME_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Try to use expired remember-me token
			const postExpiryResponse = await api.getDomainStatus(rememberMeToken, {
				domain_name: domain,
			});

			// Expired remember-me session should return 401
			expect(postExpiryResponse.status).toBe(401);
		} finally {
			await deleteTestOrgUser(email);
			await deleteTestOrgDomain(domain);
		}
	});

	test("expired signup token returns 422", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domain = generateTestDomainName();
		const email = generateTestEmail("org-signup-expiry");
		const password = TEST_PASSWORD;

		await createTestOrgDomain(domain);
		try {
			// Initiate signup
			const initSignupReq: InitSignupRequest = {
				domain_name: domain,
				email_address: email,
			};
			const initResponse = await api.initSignup(initSignupReq);
			expect(initResponse.status).toBe(201);

			// Get signup token from email
			const emailSummary = await waitForEmail(email);
			const emailMessage = await getEmailContent(emailSummary.ID);
			const signupToken = extractSignupTokenFromEmail(emailMessage);
			expect(signupToken).toBeDefined();

			// Wait for signup token to expire
			await sleep(SIGNUP_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Try to complete signup with expired token
			const completeSignupReq: CompleteSignupRequest = {
				signup_token: signupToken!,
				password,
				preferred_display_name: "Test Org User",
				home_region: "ind1",
				preferred_language: "en-US",
			};
			const expiredResponse = await api.completeSignup(completeSignupReq);

			// Expired signup token should return 422
			expect(expiredResponse.status).toBe(422);
		} finally {
			// Cleanup - user won't exist since signup didn't complete
			await deleteTestOrgDomain(domain);
		}
	});
});
