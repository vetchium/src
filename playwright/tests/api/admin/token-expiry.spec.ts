/**
 * Token Expiry Tests for Admin API
 *
 * These tests verify that expired tokens are properly rejected.
 * IMPORTANT: These tests require the CI docker-compose configuration
 * (docker-compose-ci.json) which uses short token durations:
 * - ADMIN_TFA_TOKEN_EXPIRY: 15s
 * - ADMIN_SESSION_TOKEN_EXPIRY: 30s
 *
 * Run with: docker compose -f docker-compose-ci.json up --build
 */

import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

// Token expiry durations in CI environment (with buffer for test reliability)
const TFA_TOKEN_EXPIRY_MS = 15000; // 15 seconds
const SESSION_TOKEN_EXPIRY_MS = 30000; // 30 seconds
const EXPIRY_BUFFER_MS = 8000; // 8 seconds buffer for cleanup job

/**
 * Helper to wait for a specific duration
 */
async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe("Admin Token Expiry Tests", () => {
	test.describe.configure({ timeout: 120000 }); // Increase timeout for expiry tests

	test("expired TFA token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("admin-tfa-expiry");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			// Step 1: Login to get TFA token
			const loginResponse = await api.login({ email, password });
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;
			expect(tfaToken).toBeDefined();

			// Step 2: Get TFA code from email
			const tfaCode = await getTfaCodeFromEmail(email);
			expect(tfaCode).toMatch(/^\d{6}$/);

			// Step 3: Verify TFA works before expiry
			// (Don't complete - just verify it's valid)

			// Step 4: Wait for TFA token to expire
			await sleep(TFA_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Step 5: Try to use expired TFA token
			const expiredTfaResponse = await api.verifyTFA({
				tfa_token: tfaToken,
				tfa_code: tfaCode,
			});

			// Expired token should return 401
			expect(expiredTfaResponse.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("expired session token returns 401 for authenticated endpoint", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("admin-session-expiry");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			// Step 1: Complete full login flow
			const loginResponse = await api.login({ email, password });
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({
				tfa_token: tfaToken,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;
			expect(sessionToken).toBeDefined();

			// Step 2: Verify session works before expiry
			const preExpiryResponse = await api.listApprovedDomains(sessionToken, {
				limit: 10,
			});
			expect(preExpiryResponse.status).toBe(200);

			// Step 3: Wait for session token to expire
			await sleep(SESSION_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Step 4: Try to use expired session token
			const postExpiryResponse = await api.listApprovedDomains(sessionToken, {
				limit: 10,
			});

			// Expired session should return 401
			expect(postExpiryResponse.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("expired session token returns 401 for logout", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("admin-logout-expiry");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			// Complete full login flow
			const loginResponse = await api.login({ email, password });
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({
				tfa_token: tfaToken,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Wait for session to expire
			await sleep(SESSION_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Try to logout with expired session
			const logoutResponse = await api.logout(sessionToken);

			// Expired session should return 401
			expect(logoutResponse.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("expired session token returns 401 for preferences update", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("admin-prefs-expiry");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			// Complete full login flow
			const loginResponse = await api.login({ email, password });
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({
				tfa_token: tfaToken,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Wait for session to expire
			await sleep(SESSION_TOKEN_EXPIRY_MS + EXPIRY_BUFFER_MS);

			// Try to update preferences with expired session
			const prefsResponse = await api.updatePreferences(sessionToken, {
				preferred_language: "de-DE",
			});

			// Expired session should return 401
			expect(prefsResponse.status).toBe(401);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("TFA token still valid within expiry window", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("admin-tfa-valid");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			// Login to get TFA token
			const loginResponse = await api.login({ email, password });
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Get TFA code
			const tfaCode = await getTfaCodeFromEmail(email);

			// Wait for less than expiry time (half of expiry)
			await sleep(TFA_TOKEN_EXPIRY_MS / 2);

			// Token should still be valid
			const tfaResponse = await api.verifyTFA({
				tfa_token: tfaToken,
				tfa_code: tfaCode,
			});

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.session_token).toBeDefined();
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});
