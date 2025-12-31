import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	deleteTestHubUser,
	generateTestEmail,
	generateTestDomainName,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
} from "../../../lib/db";
import {
	waitForEmail,
	getEmailContent,
	searchEmails,
	extractTfaCode,
} from "../../../lib/mailpit";
import { extractSignupTokenFromEmail } from "../../../lib/db";
import type {
	RequestSignupRequest,
	CompleteSignupRequest,
	HubLoginRequest,
	HubTFARequest,
} from "vetchium-specs/hub/hub-users";

/**
 * Helper function to create a test hub user through signup API
 */
async function createHubUserViaSignup(
	api: HubAPIClient,
	email: string,
	password: string,
	preferredLanguage: string = "en-US"
): Promise<void> {
	// Request signup
	const requestSignup: RequestSignupRequest = { email_address: email };
	await api.requestSignup(requestSignup);

	// Get token from email
	const emailSummary = await waitForEmail(email);
	const emailMessage = await getEmailContent(emailSummary.ID);
	const signupToken = extractSignupTokenFromEmail(emailMessage);

	// Complete signup
	const completeSignup: CompleteSignupRequest = {
		signup_token: signupToken!,
		password,
		preferred_display_name: "Test User",
		home_region: "ind1",
		preferred_language: preferredLanguage,
		resident_country_code: "US",
	};
	await api.completeSignup(completeSignup);
}

/**
 * Helper function to get TFA code from the most recent TFA email.
 * For hub users, there may be multiple emails (signup, TFA, etc.)
 * so we need to search for the one containing a 6-digit code.
 * Uses exponential backoff to handle delays under parallel test load.
 */
async function getTfaCodeForHubUser(email: string): Promise<string> {
	const maxRetries = 15;
	let delay = 1000; // Start with 1 second
	const maxDelay = 5000; // Cap at 5 seconds
	const backoffMultiplier = 1.5;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const messages = await searchEmails(email);

		// Check messages from most recent to oldest
		for (const msgSummary of messages) {
			const fullMessage = await getEmailContent(msgSummary.ID);
			try {
				const code = extractTfaCode(fullMessage.Text);
				return code;
			} catch (e) {
				// This email doesn't contain a TFA code, try next one
			}
		}

		if (attempt < maxRetries) {
			// Wait before retrying with exponential backoff
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay = Math.min(delay * backoffMultiplier, maxDelay);
		}
	}
	throw new Error(
		`No TFA code found in any emails for ${email} after ${maxRetries} attempts`
	);
}

test.describe("POST /hub/tfa", () => {
	test("valid TFA code with remember_me=false returns session token and preferred_language", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = "Password123$";

		await createTestAdminUser(adminEmail, "Password123$");
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Step 1: Login to get TFA token
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Step 2: Get TFA code from email (uses exponential backoff)
			const tfaCode = await getTfaCodeForHubUser(email);
			expect(tfaCode).toMatch(/^\d{6}$/);

			// Step 3: Verify TFA code with remember_me=false
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.session_token).toBeDefined();
			// Session token should be 64-character hex string (32 bytes hex-encoded)
			expect(tfaResponse.body.session_token).toMatch(/^[a-f0-9]{64}$/);
			// Default preferred_language should be en-US
			expect(tfaResponse.body.preferred_language).toBe("en-US");
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("valid TFA code with remember_me=true returns session token", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = "Password123$";

		await createTestAdminUser(adminEmail, "Password123$");
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Step 1: Login to get TFA token
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Step 2: Get TFA code from email
			const tfaCode = await getTfaCodeForHubUser(email);
			expect(tfaCode).toMatch(/^\d{6}$/);

			// Step 3: Verify TFA code with remember_me=true
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: true,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.session_token).toBeDefined();
			expect(tfaResponse.body.session_token).toMatch(/^[a-f0-9]{64}$/);
			expect(tfaResponse.body.preferred_language).toBe("en-US");
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("invalid TFA token returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);

		const tfaRequest: HubTFARequest = {
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "123456",
			remember_me: false,
		};
		const response = await api.verifyTFA(tfaRequest);

		expect(response.status).toBe(401);
	});

	test("wrong TFA code returns 403", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = "Password123$";

		await createTestAdminUser(adminEmail, "Password123$");
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Login to get TFA token
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Try with wrong code
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: "000000",
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);

			expect(tfaResponse.status).toBe(403);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("missing tfa_token returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_code: "123456",
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("missing tfa_code returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("invalid TFA code format (not 6 digits) returns 400", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		// Code too short
		const response1 = await api.verifyTFARaw({
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "12345",
			remember_me: false,
		});
		expect(response1.status).toBe(400);

		// Code too long
		const response2 = await api.verifyTFARaw({
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "1234567",
			remember_me: false,
		});
		expect(response2.status).toBe(400);

		// Code with letters
		const response3 = await api.verifyTFARaw({
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "12345a",
			remember_me: false,
		});
		expect(response3.status).toBe(400);
	});

	test("empty tfa_token returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token: "",
			tfa_code: "123456",
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("empty tfa_code returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "",
			remember_me: false,
		});

		expect(response.status).toBe(400);
	});

	test("TFA token can be reused for retry", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = "Password123$";

		await createTestAdminUser(adminEmail, "Password123$");
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Login to get TFA token
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Get correct TFA code (uses exponential backoff)
			const tfaCode = await getTfaCodeForHubUser(email);

			// First attempt with wrong code
			const wrongRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: "000000",
				remember_me: false,
			};
			const wrongResponse = await api.verifyTFA(wrongRequest);
			expect(wrongResponse.status).toBe(403);

			// Second attempt with correct code should still work
			const correctRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const correctResponse = await api.verifyTFA(correctRequest);
			expect(correctResponse.status).toBe(200);
			expect(correctResponse.body.session_token).toBeDefined();
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("TFA response returns German (de-DE) preferred_language", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = "Password123$";

		await createTestAdminUser(adminEmail, "Password123$");
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user with German preference
			await createHubUserViaSignup(api, email, password, "de-DE");

			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForHubUser(email);
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.preferred_language).toBe("de-DE");
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("TFA response returns Tamil (ta-IN) preferred_language", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = "Password123$";

		await createTestAdminUser(adminEmail, "Password123$");
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user with Tamil preference
			await createHubUserViaSignup(api, email, password, "ta-IN");

			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeForHubUser(email);
			const tfaRequest: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse = await api.verifyTFA(tfaRequest);

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.preferred_language).toBe("ta-IN");
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("multiple TFA verifications create multiple sessions", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;
		const password = "Password123$";

		await createTestAdminUser(adminEmail, "Password123$");
		await createTestApprovedDomain(domain, adminEmail);

		try {
			// Create hub user
			await createHubUserViaSignup(api, email, password);

			// Login to get TFA token
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password,
			};
			const loginResponse = await api.login(loginRequest);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Get TFA code
			const tfaCode = await getTfaCodeForHubUser(email);

			// First TFA verification
			const tfaRequest1: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: false,
			};
			const tfaResponse1 = await api.verifyTFA(tfaRequest1);
			expect(tfaResponse1.status).toBe(200);
			const sessionToken1 = tfaResponse1.body.session_token;

			// Second TFA verification (token can be reused)
			const tfaRequest2: HubTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
				remember_me: true,
			};
			const tfaResponse2 = await api.verifyTFA(tfaRequest2);
			expect(tfaResponse2.status).toBe(200);
			const sessionToken2 = tfaResponse2.body.session_token;

			// Both session tokens should be different
			expect(sessionToken1).not.toBe(sessionToken2);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
