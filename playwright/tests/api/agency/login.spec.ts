import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	generateTestEmail,
	generateTestAgencyEmail,
	deleteTestAgencyUser,
	createTestAgencyUserDirect,
	updateTestAgencyUserStatus,
} from "../../../lib/db";
import { waitForEmail, getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AgencyLoginRequest,
	AgencyTFARequest,
} from "vetchium-specs/agency/agency-users";

test.describe("POST /agency/login", () => {
	test("successful login returns TFA token and sends email", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-login-success");

		// Create test agency user directly in the database
		await createTestAgencyUserDirect(email, TEST_PASSWORD);

		try {
			const loginRequest: AgencyLoginRequest = {
				email,
				domain,
				password: TEST_PASSWORD,
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(200);
			expect(response.body.tfa_token).toBeDefined();
			// TFA token has region prefix (e.g., IND1-) + 64-character hex string
			expect(response.body.tfa_token).toMatch(/^[A-Z]{3}\d-[a-f0-9]{64}$/);

			// Verify TFA email was sent (uses exponential backoff)
			const emailMessage = await waitForEmail(email);
			expect(emailMessage).toBeDefined();
			expect(emailMessage.To[0].Address).toBe(email);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("login with non-existent domain returns 404", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email } = generateTestAgencyEmail("agency-login-no-domain");

		// Create test agency user directly in the database
		await createTestAgencyUserDirect(email, TEST_PASSWORD);

		try {
			const loginRequest: AgencyLoginRequest = {
				email,
				domain: "nonexistent-domain.example.com",
				password: TEST_PASSWORD,
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("login with wrong password returns 401 and records agency.login_failed event", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-login-wrong-pw");

		// Create test agency user directly in the database
		await createTestAgencyUserDirect(email, TEST_PASSWORD);

		try {
			const loginRequest: AgencyLoginRequest = {
				email,
				domain,
				password: "WrongPassword456!",
			};
			const before = new Date().toISOString();
			const response = await api.login(loginRequest);

			expect(response.status).toBe(401);

			// Verify agency.login_failed audit log was recorded
			// Login with correct password to get a session token for audit log query
			const successResp = await api.login({
				email,
				domain,
				password: TEST_PASSWORD,
			});
			expect(successResp.status).toBe(200);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaRequest: AgencyTFARequest = {
				tfa_token: successResp.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResp = await api.verifyTFA(tfaRequest);
			expect(tfaResp.status).toBe(200);
			const sessionToken = tfaResp.body.session_token;

			const auditResp = await api.filterAuditLogs(sessionToken, {
				event_types: ["agency.login_failed"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe(
				"agency.login_failed"
			);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("login with non-existent email returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-login-no-user");

		// Create test agency user directly in the database
		await createTestAgencyUserDirect(email, TEST_PASSWORD);

		try {
			const loginRequest: AgencyLoginRequest = {
				email: "nonexistent@" + domain,
				domain,
				password: TEST_PASSWORD,
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	test("login with disabled account returns 422", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-login-disabled");

		// Create test agency user directly in the database
		await createTestAgencyUserDirect(email, TEST_PASSWORD);

		try {
			// Disable the user
			await updateTestAgencyUserStatus(email, "disabled");

			const loginRequest: AgencyLoginRequest = {
				email,
				domain,
				password: TEST_PASSWORD,
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(422);
		} finally {
			await deleteTestAgencyUser(email);
		}
	});

	// Validation error tests
	test("missing email returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.loginRaw({
			domain: "example.com",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const email = generateTestEmail("agency-login-no-dom");

		const response = await api.loginRaw({
			email,
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("missing password returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-login-no-pw");

		const response = await api.loginRaw({
			email,
			domain,
		});

		expect(response.status).toBe(400);
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.loginRaw({
			email: "not-an-email",
			domain: "example.com",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("empty email returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.loginRaw({
			email: "",
			domain: "example.com",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const email = generateTestEmail("agency-login-empty-dom");

		const response = await api.loginRaw({
			email,
			domain: "",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("empty password returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("agency-login-empty-pw");

		const response = await api.loginRaw({
			email,
			domain,
			password: "",
		});

		expect(response.status).toBe(400);
	});
});
