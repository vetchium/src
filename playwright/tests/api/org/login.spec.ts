import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	generateTestEmail,
	generateTestOrgEmail,
	deleteTestOrgUser,
	getTestOrgUser,
	createTestVerifiedDomain,
	updateTestOrgUserStatus,
} from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgInitSignupRequest,
	OrgLoginRequest,
} from "vetchium-specs/org/org-users";

/**
 * Helper function to create a test org user with a verified domain.
 * Returns the email and domain for use in login tests.
 */
async function createTestOrgUserWithVerifiedDomain(
	api: OrgAPIClient,
	emailPrefix: string
): Promise<{ email: string; domain: string }> {
	const { email, domain } = generateTestOrgEmail(emailPrefix);

	// Init signup
	const initRequest: OrgInitSignupRequest = {
		email,
		home_region: "ind1",
	};
	const initResponse = await api.initSignup(initRequest);
	expect(initResponse.status).toBe(200);

	// Wait for email and extract token
	const emailMessage = await waitForEmail(email);
	const fullEmail = await getEmailContent(emailMessage.ID);
	const tokenMatch = fullEmail.HTML.match(/token=([a-f0-9]{64})/);
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

	return { email, domain };
}

test.describe("POST /employer/login", () => {
	test("successful login returns TFA token and sends email", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserWithVerifiedDomain(
			api,
			"org-login-success"
		);

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
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserWithVerifiedDomain(
			api,
			"org-login-no-domain"
		);

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

	test("login with wrong password returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserWithVerifiedDomain(
			api,
			"org-login-wrong-pw"
		);

		try {
			const loginRequest: OrgLoginRequest = {
				email,
				domain,
				password: "WrongPassword456!",
			};
			const response = await api.login(loginRequest);

			expect(response.status).toBe(401);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("login with non-existent email returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserWithVerifiedDomain(
			api,
			"org-login-no-user"
		);

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
		const api = new OrgAPIClient(request);
		const { email, domain } = await createTestOrgUserWithVerifiedDomain(
			api,
			"org-login-disabled"
		);

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
		const api = new OrgAPIClient(request);

		const response = await api.loginRaw({
			domain: "example.com",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const email = generateTestEmail("org-login-no-dom");

		const response = await api.loginRaw({
			email,
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("missing password returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const email = generateTestEmail("org-login-no-pw");

		const response = await api.loginRaw({
			email,
			domain: "example.com",
		});

		expect(response.status).toBe(400);
	});

	test("empty email returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.loginRaw({
			email: "",
			domain: "example.com",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const email = generateTestEmail("org-login-empty-dom");

		const response = await api.loginRaw({
			email,
			domain: "",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("empty password returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const email = generateTestEmail("org-login-empty-pw");

		const response = await api.loginRaw({
			email,
			domain: "example.com",
			password: "",
		});

		expect(response.status).toBe(400);
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.loginRaw({
			email: "not-an-email",
			domain: "example.com",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("password too short returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
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
