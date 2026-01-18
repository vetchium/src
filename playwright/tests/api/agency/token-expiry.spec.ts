/**
 * Token Expiry Tests for Agency API
 *
 * These tests verify that expired tokens are properly rejected.
 * IMPORTANT: These tests require the CI docker-compose configuration
 * (docker-compose-ci.json) which uses short token durations:
 * - AGENCY_TFA_TOKEN_EXPIRY: 15s
 * - AGENCY_SESSION_TOKEN_EXPIRY: 30s
 * - AGENCY_REMEMBER_ME_EXPIRY: 60s
 *
 * Run with: docker compose -f docker-compose-ci.json up --build
 */

import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	deleteTestAgencyUser,
	generateTestAgencyEmail,
	createTestAgencyUserDirect,
} from "../../../lib/db";
import {
	searchEmails,
	getEmailContent,
	extractTfaCode,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AgencyLoginRequest,
	AgencyTFARequest,
} from "vetchium-specs/agency/agency-users";

// Token expiry durations in CI environment (with buffer for test reliability)
const TFA_TOKEN_EXPIRY_MS = 15000; // 15 seconds
const SESSION_TOKEN_EXPIRY_MS = 30000; // 30 seconds
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
async function getTfaCodeForAgencyUser(email: string): Promise<string> {
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

test.describe("Agency Token Expiry Tests", () => {
	test.describe.configure({ timeout: 120000 }); // Increase timeout for expiry tests

	test("expired TFA token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-tfa-expiry");

		// Create test agency user directly in the database
		await createTestAgencyUserDirect(email, TEST_PASSWORD);

		try {
			// Step 1: Login to get TFA token
			const loginReq: AgencyLoginRequest = {
				email,
				domain,
				password: TEST_PASSWORD,
			};
			const loginResponse = await api.login(loginReq);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;
			expect(tfaToken).toBeDefined();

			// Step 2: Get TFA code from email
			const tfaCode = await getTfaCodeForAgencyUser(email);
			expect(tfaCode).toMatch(/^\d{6}$/);

			// Step 3: Wait for TFA token to expire
			await sleep(TFA_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Step 4: Try to use expired TFA token
			const tfaReq: AgencyTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const expiredTfaResponse = await api.verifyTFA(tfaReq);

			// Expired token should return 401
			expect(expiredTfaResponse.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("expired session token returns 401 for authenticated endpoint", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-session-expiry");

		// Create test agency user directly in the database
		await createTestAgencyUserDirect(email, TEST_PASSWORD);

		try {
			// Complete full login flow
			const loginReq: AgencyLoginRequest = {
				email,
				domain,
				password: TEST_PASSWORD,
			};
			const loginResponse = await api.login(loginReq);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForAgencyUser(email);
			const tfaReq: AgencyTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaReq);
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;
			expect(sessionToken).toBeDefined();

			// Step 2: Verify session works before expiry (test with logout)
			const preExpiryResponse = await api.logout(sessionToken);
			expect(preExpiryResponse.status).toBe(200);

			// Login again to get a new session for expiry test
			const loginResponse2 = await api.login(loginReq);
			const tfaToken2 = loginResponse2.body.tfa_token;
			const tfaCode2 = await getTfaCodeForAgencyUser(email);
			const tfaReq2: AgencyTFARequest = {
				tfa_token: tfaToken2,
				tfa_code: tfaCode2,
				remember_me: false,
			};
			const tfaResponse2 = await api.verifyTFA(tfaReq2);
			const sessionToken2 = tfaResponse2.body.session_token;

			// Step 3: Wait for session token to expire
			await sleep(SESSION_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Step 4: Try to use expired session token
			const postExpiryResponse = await api.logout(sessionToken2);

			// Expired session should return 401
			expect(postExpiryResponse.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("expired session token returns 401 for logout", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-logout-expiry");

		// Create test agency user directly in the database
		await createTestAgencyUserDirect(email, TEST_PASSWORD);

		try {
			// Complete full login flow
			const loginReq: AgencyLoginRequest = {
				email,
				domain,
				password: TEST_PASSWORD,
			};
			const loginResponse = await api.login(loginReq);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForAgencyUser(email);
			const tfaReq: AgencyTFARequest = {
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
			await deleteTestAgencyUser(email);
		}
	});

	test("TFA token still valid within expiry window", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-tfa-valid");

		// Create test agency user directly in the database
		await createTestAgencyUserDirect(email, TEST_PASSWORD);

		try {
			// Login to get TFA token
			const loginReq: AgencyLoginRequest = {
				email,
				domain,
				password: TEST_PASSWORD,
			};
			const loginResponse = await api.login(loginReq);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Get TFA code
			const tfaCode = await getTfaCodeForAgencyUser(email);

			// Wait for less than expiry time (half of expiry)
			await sleep(TFA_TOKEN_EXPIRY_MS / 2);

			// Token should still be valid
			const tfaReq: AgencyTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaReq);

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.session_token).toBeDefined();
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("expired remember-me token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-remember-expiry");

		// Create test agency user directly in the database
		await createTestAgencyUserDirect(email, TEST_PASSWORD);

		try {
			// Login with remember_me flag
			const loginReq: AgencyLoginRequest = {
				email,
				domain,
				password: TEST_PASSWORD,
			};
			const loginResponse = await api.login(loginReq);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForAgencyUser(email);
			const tfaReq: AgencyTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: true, // Request remember-me session
			};
			const tfaResponse = await api.verifyTFA(tfaReq);
			expect(tfaResponse.status).toBe(200);
			const rememberMeToken = tfaResponse.body.session_token;
			expect(rememberMeToken).toBeDefined();

			// Verify remember-me session works before expiry
			const preExpiryResponse = await api.logout(rememberMeToken);
			expect(preExpiryResponse.status).toBe(200);

			// Login again with remember_me to get a new token for expiry test
			const loginResponse2 = await api.login(loginReq);
			const tfaToken2 = loginResponse2.body.tfa_token;
			const tfaCode2 = await getTfaCodeForAgencyUser(email);
			const tfaReq2: AgencyTFARequest = {
				tfa_token: tfaToken2,
				tfa_code: tfaCode2,
				remember_me: true,
			};
			const tfaResponse2 = await api.verifyTFA(tfaReq2);
			const rememberMeToken2 = tfaResponse2.body.session_token;

			// Wait for remember-me token to expire
			await sleep(REMEMBER_ME_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Try to use expired remember-me token
			const postExpiryResponse = await api.logout(rememberMeToken2);

			// Expired remember-me session should return 401
			expect(postExpiryResponse.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});
});
