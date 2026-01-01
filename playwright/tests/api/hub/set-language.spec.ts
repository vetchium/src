import { test, expect } from "@playwright/test";
import {
	deleteTestHubUser,
	generateTestEmail,
	createTestApprovedDomain,
	generateTestDomainName,
	permanentlyDeleteTestApprovedDomain,
	extractSignupTokenFromEmail,
} from "../../../lib/db";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	waitForEmail,
	getEmailContent,
	searchEmails,
	extractTfaCode,
} from "../../../lib/mailpit";
import type {
	HubSetLanguageRequest,
	RequestSignupRequest,
	CompleteSignupRequest,
} from "vetchium-specs/hub/hub-users";

/**
 * Helper function to get TFA code from the most recent TFA email.
 */
async function getTfaCodeForHubUser(email: string): Promise<string> {
	const maxRetries = 15;
	let delay = 1000;
	const maxDelay = 5000;
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
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay = Math.min(delay * backoffMultiplier, maxDelay);
		}
	}
	throw new Error(
		`No TFA code found in any emails for ${email} after ${maxRetries} attempts`
	);
}

test.describe("Hub Set Language API", () => {
	let email: string;
	let domainName: string;
	let password: string;
	let sessionToken: string;
	let api: HubAPIClient;

	test.beforeEach(async ({ request }) => {
		api = new HubAPIClient(request);
		email = generateTestEmail("set-language");
		domainName = generateTestDomainName("set-language");
		password = "Password123$";

		// Create approved domain
		await createTestApprovedDomain(domainName);

		// Request signup
		const requestSignup: RequestSignupRequest = { email_address: email };
		await api.requestSignup(requestSignup);

		// Get token from email
		const emailSummary = await waitForEmail(email);
		const emailMessage = await getEmailContent(emailSummary.ID);
		const signupToken = extractSignupTokenFromEmail(emailMessage);

		// Complete signup with en-US language
		const completeSignup: CompleteSignupRequest = {
			signup_token: signupToken!,
			password,
			preferred_display_name: "Test User",
			home_region: "ind1",
			preferred_language: "en-US",
			resident_country_code: "US",
		};
		await api.completeSignup(completeSignup);

		// Login to get session token
		const loginResponse = await api.login({
			email_address: email,
			password: password,
		});
		expect(loginResponse.status).toBe(200);

		// Get TFA code from email and complete TFA
		const tfaCode = await getTfaCodeForHubUser(email);
		const tfaResponse = await api.verifyTFA({
			tfa_token: loginResponse.body.tfa_token,
			tfa_code: tfaCode,
			remember_me: false,
		});
		expect(tfaResponse.status).toBe(200);
		sessionToken = tfaResponse.body.session_token;
	});

	test.afterEach(async () => {
		await deleteTestHubUser(email);
		await permanentlyDeleteTestApprovedDomain(domainName);
	});

	test("should update language successfully", async () => {
		const request: HubSetLanguageRequest = {
			language: "de-DE",
		};

		const response = await api.setLanguage(sessionToken, request);
		expect(response.status).toBe(200);
	});

	test("should fail without authentication", async () => {
		const request: HubSetLanguageRequest = {
			language: "de-DE",
		};

		const response = await api.setLanguageRaw("invalid-token", request);
		expect(response.status).toBe(401);
	});

	test("should fail with missing language field", async () => {
		const response = await api.setLanguageRaw(sessionToken, {});
		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();
		expect(Array.isArray(response.errors)).toBe(true);
		if (Array.isArray(response.errors)) {
			expect(response.errors.length).toBeGreaterThan(0);
			expect(response.errors[0].field).toBe("language");
		}
	});

	test("should fail with invalid language code", async () => {
		const response = await api.setLanguageRaw(sessionToken, {
			language: "invalid-lang",
		});
		expect(response.status).toBe(400);
	});

	test("should fail with empty string language", async () => {
		const response = await api.setLanguageRaw(sessionToken, {
			language: "",
		});
		expect(response.status).toBe(400);
	});

	test("should update to each supported language", async () => {
		const languages = ["en-US", "de-DE", "ta-IN"];

		for (const lang of languages) {
			const request: HubSetLanguageRequest = {
				language: lang,
			};

			const response = await api.setLanguage(sessionToken, request);
			expect(response.status).toBe(200);
		}
	});

	test("should fail with unsupported language code", async () => {
		const response = await api.setLanguageRaw(sessionToken, {
			language: "fr-FR", // Not in supported list
		});
		expect(response.status).toBe(400);
	});

	test("should fail with null language", async () => {
		const response = await api.setLanguageRaw(sessionToken, {
			language: null,
		});
		expect(response.status).toBe(400);
	});

	test("should fail with numeric language", async () => {
		const response = await api.setLanguageRaw(sessionToken, {
			language: 123,
		});
		expect(response.status).toBe(400);
	});
});
