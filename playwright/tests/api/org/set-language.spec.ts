import { test, expect } from "@playwright/test";
import {
	deleteTestOrgUser,
	createTestOrgAdminDirect,
	generateTestOrgEmail,
} from "../../../lib/db";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { TEST_PASSWORD } from "../../../lib/constants";
import {
	getEmailContent,
	searchEmails,
	extractTfaCode,
} from "../../../lib/mailpit";
import type { OrgSetLanguageRequest } from "vetchium-specs/org/org-users";

/**
 * Helper function to get TFA code from the most recent TFA email.
 */
async function getTfaCodeForOrgUser(email: string): Promise<string> {
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

test.describe("Org (Employer) Set Language API", () => {
	let email: string;
	let domainName: string;
	let password: string;
	let sessionToken: string;
	let api: OrgAPIClient;

	test.beforeEach(async ({ request }) => {
		api = new OrgAPIClient(request);
		password = TEST_PASSWORD;
		const testEmail = generateTestOrgEmail("org-lang");
		email = testEmail.email;
		domainName = testEmail.domain;

		// Create test user directly in DB (bypass signup flow)
		await createTestOrgAdminDirect(email, password, "ind1", {
			domain: domainName,
		});

		// Login to get session token
		const loginResponse = await api.login({
			email: email,
			domain: domainName,
			password: password,
		});
		expect(loginResponse.status).toBe(200);

		// Get TFA code from email and complete TFA
		const tfaCode = await getTfaCodeForOrgUser(email);
		const tfaResponse = await api.verifyTFA({
			tfa_token: loginResponse.body.tfa_token,
			tfa_code: tfaCode,
			remember_me: false,
		});
		expect(tfaResponse.status).toBe(200);
		sessionToken = tfaResponse.body.session_token;
	});

	test.afterEach(async () => {
		if (email) {
			await deleteTestOrgUser(email);
		}
	});

	test("should update language successfully and record org.set_language event", async () => {
		const request: OrgSetLanguageRequest = {
			language: "de-DE",
		};

		const before = new Date(Date.now() - 2000).toISOString();
		const response = await api.setLanguage(sessionToken, request);
		expect(response.status).toBe(200);

		// Verify org.set_language audit log entry was created
		const auditResp = await api.listAuditLogs(sessionToken, {
			event_types: ["org.set_language"],
			start_time: before,
		});
		expect(auditResp.status).toBe(200);
		expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
		expect(auditResp.body.audit_logs[0].event_type).toBe("org.set_language");
	});

	test("should fail without authentication", async () => {
		const request: OrgSetLanguageRequest = {
			language: "de-DE",
		};

		const response = await api.setLanguageWithoutAuth(request);
		expect(response.status).toBe(401);
	});

	test("should fail with missing language field", async () => {
		const response = await api.setLanguageRaw(sessionToken, {});
		expect(response.status).toBe(400);
	});

	test("should fail with invalid language code", async () => {
		const response = await api.setLanguageRaw(sessionToken, {
			language: "invalid-lang",
		});
		expect(response.status).toBe(400);
	});

	test("should update to each supported language", async () => {
		const languages = ["en-US", "de-DE", "ta-IN"];

		for (const lang of languages) {
			const request: OrgSetLanguageRequest = {
				language: lang as any,
			};

			const response = await api.setLanguage(sessionToken, request);
			expect(response.status).toBe(200);
		}
	});
});
