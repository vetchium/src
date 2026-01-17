import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	generateTestAgencyEmail,
	deleteTestAgencyUser,
	createTestAgencyUserDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AgencyLoginRequest,
	AgencyTFARequest,
} from "vetchium-specs/agency/agency-users";

/**
 * Helper function to create a test agency user, log them in, and complete TFA.
 * Returns the email and session token for use in logout tests.
 */
async function createAgencyUserAndGetSession(
	api: AgencyAPIClient,
	emailPrefix: string
): Promise<{ email: string; sessionToken: string }> {
	const { email, domain } = generateTestAgencyEmail(emailPrefix);

	// Create test agency user directly in the database
	await createTestAgencyUserDirect(email, TEST_PASSWORD);

	// Clear any existing emails for this address
	await deleteEmailsFor(email);

	// Login to get TFA token
	const loginRequest: AgencyLoginRequest = {
		email,
		domain,
		password: TEST_PASSWORD,
	};
	const loginResponse = await api.login(loginRequest);
	expect(loginResponse.status).toBe(200);
	expect(loginResponse.body.tfa_token).toBeDefined();

	// Get TFA code from email and verify
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRequest: AgencyTFARequest = {
		tfa_token: loginResponse.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	};
	const tfaResponse = await api.verifyTFA(tfaRequest);
	expect(tfaResponse.status).toBe(200);
	expect(tfaResponse.body.session_token).toBeDefined();

	return { email, sessionToken: tfaResponse.body.session_token };
}

test.describe("POST /agency/logout", () => {
	test("successful logout returns 200", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, sessionToken } = await createAgencyUserAndGetSession(
			api,
			"agency-logout-success"
		);

		try {
			const response = await api.logout(sessionToken);

			expect(response.status).toBe(200);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("logout invalidates session token", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, sessionToken } = await createAgencyUserAndGetSession(
			api,
			"agency-logout-invalid"
		);

		try {
			// First logout should succeed
			const response1 = await api.logout(sessionToken);
			expect(response1.status).toBe(200);

			// Second logout with same token should fail (token invalidated)
			const response2 = await api.logout(sessionToken);
			expect(response2.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("logout without Authorization header returns 401", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);

		const response = await api.logoutWithoutAuth();

		expect(response.status).toBe(401);
	});

	test("logout with invalid session token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		// Use a fake session token with region prefix
		const fakeToken = "ind1:" + "a".repeat(64);
		const response = await api.logout(fakeToken);

		expect(response.status).toBe(401);
	});

	test("logout with malformed session token returns 401", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);

		// Use a malformed token without proper region prefix
		const response = await api.logout("invalid-token");

		expect(response.status).toBe(401);
	});
});
