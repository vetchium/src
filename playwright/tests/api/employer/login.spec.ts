import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	generateTestEmail,
	generateTestOrgEmail,
	deleteTestOrgUser,
	createTestOrgUserDirect,
	createTestOrgAdminDirect,
	updateTestOrgUserStatus,
} from "../../../lib/db";
import { waitForEmail, getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/employer/employer-users";

test.describe("POST /employer/login", () => {
	test("successful login returns TFA token and sends email", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("org-login-success");

		// Create test org user directly in the database
		await createTestOrgUserDirect(email, TEST_PASSWORD);

		try {
			const loginRequest: OrgLoginRequest = {
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
			await deleteTestOrgUser(email);
		}
	});

	test("login with non-existent domain returns 404", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email } = generateTestOrgEmail("org-login-no-domain");

		// Create test org user directly in the database
		await createTestOrgUserDirect(email, TEST_PASSWORD);

		try {
			const loginRequest: OrgLoginRequest = {
				email,
				domain: "nonexistent-domain.example.com",
				password: TEST_PASSWORD,
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("login with wrong password returns 401 and records employer.login_failed event", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("org-login-wrong-pw");

		// Create test org user directly in the database (needs superadmin for audit log access)
		await createTestOrgAdminDirect(email, TEST_PASSWORD);

		try {
			const loginRequest: OrgLoginRequest = {
				email,
				domain,
				password: "WrongPassword456!",
			};
			const before = new Date().toISOString();
			const response = await api.login(loginRequest);

			expect(response.status).toBe(401);

			// Verify employer.login_failed audit log was recorded
			// Login with correct password to get a session token for audit log query
			const successResp = await api.login({
				email,
				domain,
				password: TEST_PASSWORD,
			});
			expect(successResp.status).toBe(200);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaRequest: OrgTFARequest = {
				tfa_token: successResp.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResp = await api.verifyTFA(tfaRequest);
			expect(tfaResp.status).toBe(200);
			const sessionToken = tfaResp.body.session_token;

			const auditResp = await api.filterAuditLogs(sessionToken, {
				event_types: ["employer.login_failed"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe(
				"employer.login_failed"
			);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("login with non-existent email returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("org-login-no-user");

		// Create test org user directly in the database
		await createTestOrgUserDirect(email, TEST_PASSWORD);

		try {
			const loginRequest: OrgLoginRequest = {
				email: "nonexistent@" + domain,
				domain,
				password: TEST_PASSWORD,
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("login with disabled account returns 422", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("org-login-disabled");

		// Create test org user directly in the database
		await createTestOrgUserDirect(email, TEST_PASSWORD);

		try {
			// Disable the user
			await updateTestOrgUserStatus(email, "disabled");

			const loginRequest: OrgLoginRequest = {
				email,
				domain,
				password: TEST_PASSWORD,
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(422);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	// Validation error tests
	test("missing email returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.loginRaw({
			domain: "example.com",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const email = generateTestEmail("org-login-no-dom");

		const response = await api.loginRaw({
			email,
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("missing password returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const email = generateTestEmail("org-login-no-pw");

		const response = await api.loginRaw({
			email,
			domain: "example.com",
		});

		expect(response.status).toBe(400);
	});

	test("empty email returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.loginRaw({
			email: "",
			domain: "example.com",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const email = generateTestEmail("org-login-empty-dom");

		const response = await api.loginRaw({
			email,
			domain: "",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("empty password returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const email = generateTestEmail("org-login-empty-pw");

		const response = await api.loginRaw({
			email,
			domain: "example.com",
			password: "",
		});

		expect(response.status).toBe(400);
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.loginRaw({
			email: "not-an-email",
			domain: "example.com",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("password too short returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const email = generateTestEmail("org-login-short-pw");

		// Password must be at least 12 characters
		const response = await api.loginRaw({
			email,
			domain: "example.com",
			password: "Short1$",
		});

		expect(response.status).toBe(400);
	});
});
