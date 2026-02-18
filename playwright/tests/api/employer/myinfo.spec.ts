import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

/**
 * Helper to perform full login flow and get session token.
 */
async function getSessionToken(
	api: EmployerAPIClient,
	email: string,
	domain: string,
	password: string
): Promise<string> {
	const loginResponse = await api.login({ email, domain, password });
	expect(loginResponse.status).toBe(200);
	const tfaToken = loginResponse.body.tfa_token;

	const tfaCode = await getTfaCodeFromEmail(email);

	const tfaResponse = await api.verifyTFA({
		tfa_token: tfaToken,
		tfa_code: tfaCode,
		remember_me: false,
	});
	expect(tfaResponse.status).toBe(200);

	return tfaResponse.body.session_token;
}

test.describe("GET /employer/myinfo", () => {
	test("returns org user info with roles and employer name for valid session", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("myinfo-success");
		const password = TEST_PASSWORD;

		await createTestOrgAdminDirect(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, domain, password);

			const response = await api.getMyInfo(sessionToken);

			expect(response.status).toBe(200);
			expect(response.body.org_user_id).toBeDefined();
			expect(response.body.full_name).toBeDefined();
			expect(response.body.preferred_language).toBeDefined();
			expect(response.body.employer_name).toBe(domain);
			expect(Array.isArray(response.body.roles)).toBe(true);
		} finally {
			await deleteTestOrgUser(email, domain);
		}
	});

	test("returns 401 for missing session token", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.getMyInfoWithoutAuth();

		expect(response.status).toBe(401);
	});

	test("returns 401 for invalid session token", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.getMyInfo(
			"0000000000000000000000000000000000000000000000000000000000000000"
		);

		expect(response.status).toBe(401);
	});

	test("returns 401 for expired session token", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("myinfo-expired");
		const password = TEST_PASSWORD;

		await createTestOrgAdminDirect(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, domain, password);

			// Logout to invalidate the session
			const logoutResponse = await api.logout(sessionToken);
			expect(logoutResponse.status).toBe(200);

			// Try to use the expired token
			const response = await api.getMyInfo(sessionToken);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestOrgUser(email, domain);
		}
	});

	test("returns empty roles array for user with no roles", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("myinfo-no-roles");
		const password = TEST_PASSWORD;

		await createTestOrgUserDirect(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, domain, password);

			const response = await api.getMyInfo(sessionToken);

			expect(response.status).toBe(200);
			expect(response.body.roles).toEqual([]);
		} finally {
			await deleteTestOrgUser(email);
		}
	});
});
