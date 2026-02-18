import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	createTestOrgUserDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/employer/employer-users";

/**
 * Helper function to create a test org user with a verified domain and log them in.
 * Returns the email, domain, and TFA token for use in TFA tests.
 */
async function createOrgUserAndLogin(
	api: EmployerAPIClient,
	emailPrefix: string
): Promise<{ email: string; domain: string; tfaToken: string }> {
	const { email, domain } = generateTestOrgEmail(emailPrefix);

	// Create test org user directly in the database
	await createTestOrgUserDirect(email, TEST_PASSWORD);

	// Clear any existing emails for this address
	await deleteEmailsFor(email);

	// Login to get TFA token
	const loginRequest: OrgLoginRequest = {
		email,
		domain,
		password: TEST_PASSWORD,
	};
	const loginResponse = await api.login(loginRequest);
	expect(loginResponse.status).toBe(200);
	expect(loginResponse.body.tfa_token).toBeDefined();

	return { email, domain, tfaToken: loginResponse.body.tfa_token };
}

test.describe("POST /employer/tfa", () => {
	test("successful TFA verification returns session token", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email, tfaToken } = await createOrgUserAndLogin(
			api,
			"org-tfa-success"
		);

		try {
			// Get TFA code from email
			const tfaCode = await getTfaCodeFromEmail(email);
			expect(tfaCode).toMatch(/^\d{6}$/);

			const tfaRequest: OrgTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const response = await api.verifyTFA(tfaRequest);

			expect(response.status).toBe(200);
			expect(response.body.session_token).toBeDefined();
			// Session token has region prefix (e.g., IND1-) + 64 hex chars
			expect(response.body.session_token).toMatch(/^[A-Z]{3}\d-[a-f0-9]{64}$/);
			expect(response.body.preferred_language).toBeDefined();
			expect(response.body.employer_name).toBeDefined();
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("TFA with remember_me returns session token", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, tfaToken } = await createOrgUserAndLogin(
			api,
			"org-tfa-remember"
		);

		try {
			// Get TFA code from email
			const tfaCode = await getTfaCodeFromEmail(email);

			const tfaRequest: OrgTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: true,
			};
			const response = await api.verifyTFA(tfaRequest);

			expect(response.status).toBe(200);
			expect(response.body.session_token).toBeDefined();
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("invalid TFA token returns 401", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const tfaRequest: OrgTFARequest = {
			tfa_token: "IND1-" + "a".repeat(64), // Invalid token with valid region prefix
			tfa_code: "123456",
			remember_me: false,
		};
		const response = await api.verifyTFA(tfaRequest);

		expect(response.status).toBe(401);
	});

	test("wrong TFA code returns 403", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, tfaToken } = await createOrgUserAndLogin(
			api,
			"org-tfa-wrong-code"
		);

		try {
			const tfaRequest: OrgTFARequest = {
				tfa_token: tfaToken,
				tfa_code: "000000", // Wrong code
				remember_me: false,
			};
			const response = await api.verifyTFA(tfaRequest);

			expect(response.status).toBe(403);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("TFA token can be reused until expiry", async ({ request }) => {
		const api = new EmployerAPIClient(request);
		const { email, tfaToken } = await createOrgUserAndLogin(
			api,
			"org-tfa-reuse"
		);

		try {
			// Get TFA code from email
			const tfaCode = await getTfaCodeFromEmail(email);

			// Use the token successfully first
			const tfaRequest: OrgTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const response = await api.verifyTFA(tfaRequest);
			expect(response.status).toBe(200);

			// Token is intentionally reusable - using it again creates another session
			const response2 = await api.verifyTFA(tfaRequest);
			expect(response2.status).toBe(200);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	// Validation error tests
	test("missing tfa_token returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_code: "123456",
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("missing tfa_code returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token: "a".repeat(64),
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("empty tfa_token returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token: "",
			tfa_code: "123456",
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("empty tfa_code returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token: "a".repeat(64),
			tfa_code: "",
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("tfa_code with wrong length returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		// Code must be exactly 6 digits
		const response = await api.verifyTFARaw({
			tfa_token: "a".repeat(64),
			tfa_code: "12345", // 5 digits
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("tfa_code with non-digits returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token: "a".repeat(64),
			tfa_code: "12345a", // Contains letter
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});
});
