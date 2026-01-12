import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	generateTestEmail,
	deleteTestOrgUser,
	getTestOrgUser,
	createTestVerifiedDomain,
} from "../../../lib/db";
import {
	waitForEmail,
	getEmailContent,
	getTfaCodeFromEmail,
	deleteEmailsFor,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgInitSignupRequest,
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";

/**
 * Helper function to create a test org user with a verified domain and log them in.
 * Returns the email, domain, and TFA token for use in TFA tests.
 */
async function createOrgUserAndLogin(
	api: OrgAPIClient,
	emailPrefix: string
): Promise<{ email: string; domain: string; tfaToken: string }> {
	const email = generateTestEmail(emailPrefix);
	const domain = email.split("@")[1]; // test.vetchium.com

	// Init signup
	const initRequest: OrgInitSignupRequest = {
		email,
		home_region: "ind1",
	};
	const initResponse = await api.initSignup(initRequest);
	expect(initResponse.status).toBe(200);

	// Wait for signup email and extract token
	const signupEmail = await waitForEmail(email);
	const fullSignupEmail = await getEmailContent(signupEmail.ID);
	const tokenMatch = fullSignupEmail.HTML.match(/token=([a-f0-9]{64})/);
	expect(tokenMatch).toBeDefined();
	const signupToken = tokenMatch![1];

	// Complete signup
	const completeResponse = await api.completeSignup({
		signup_token: signupToken,
		password: TEST_PASSWORD,
	});
	expect(completeResponse.status).toBe(201);

	// Get the org user to find employer ID
	const orgUser = await getTestOrgUser(email);
	expect(orgUser).toBeDefined();

	// Create a verified domain for the employer
	await createTestVerifiedDomain(domain, orgUser!.employer_id, "ind1");

	// Clear emails to prepare for login TFA email
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
		const api = new OrgAPIClient(request);
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
			// Session token has region prefix (e.g., ind1:...) + 64 hex chars
			expect(response.body.session_token).toMatch(/^[a-z]{3}\d:[a-f0-9]{64}$/);
			expect(response.body.preferred_language).toBeDefined();
			expect(response.body.employer_name).toBeDefined();
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("TFA with remember_me returns session token", async ({ request }) => {
		const api = new OrgAPIClient(request);
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
		const api = new OrgAPIClient(request);

		const tfaRequest: OrgTFARequest = {
			tfa_token: "a".repeat(64), // Invalid token
			tfa_code: "123456",
			remember_me: false,
		};
		const response = await api.verifyTFA(tfaRequest);

		expect(response.status).toBe(401);
	});

	test("wrong TFA code returns 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
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

	test("expired TFA token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, tfaToken } = await createOrgUserAndLogin(
			api,
			"org-tfa-expired"
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

			// Try to use the same token again (should be consumed/expired)
			const response2 = await api.verifyTFA(tfaRequest);
			expect(response2.status).toBe(401);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	// Validation error tests
	test("missing tfa_token returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_code: "123456",
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("missing tfa_code returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token: "a".repeat(64),
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("empty tfa_token returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token: "",
			tfa_code: "123456",
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("empty tfa_code returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token: "a".repeat(64),
			tfa_code: "",
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("tfa_code with wrong length returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		// Code must be exactly 6 digits
		const response = await api.verifyTFARaw({
			tfa_token: "a".repeat(64),
			tfa_code: "12345", // 5 digits
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("tfa_code with non-digits returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token: "a".repeat(64),
			tfa_code: "12345a", // Contains letter
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});
});
