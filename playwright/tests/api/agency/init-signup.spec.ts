import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import { generateTestAgencyEmail } from "../../../lib/db";
import {
	searchEmails,
	getEmailContent,
	extractAgencySignupToken,
	waitForEmail,
} from "../../../lib/mailpit";
import type { AgencyInitSignupRequest } from "vetchium-specs/agency/agency-users";

// Helper to wait for both signup emails
async function waitForBothSignupEmails(
	userEmail: string,
	maxRetries = 10,
	delayMs = 1000
) {
	for (let i = 0; i < maxRetries; i++) {
		const messages = await searchEmails(userEmail);
		if (messages.length >= 2) {
			return messages;
		}
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	throw new Error(
		`Expected 2 emails for ${userEmail}, but got ${(await searchEmails(userEmail)).length}`
	);
}

test.describe("POST /agency/init-signup", () => {
	test("successful signup returns DNS verification instructions and sends two emails", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		// Use unique domain for each test to avoid 409 conflicts
		const { email: userEmail } = generateTestAgencyEmail("init-signup");

		try {
			const initRequest: AgencyInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const response = await api.initSignup(initRequest);

			expect(response.status).toBe(200);

			// Verify DNS verification response fields
			expect(response.body.domain).toBeDefined();
			expect(response.body.dns_record_name).toBeDefined();
			expect(response.body.token_expires_at).toBeDefined();
			expect(response.body.message).toBeDefined();

			// SECURITY: dns_record_value should NOT be in the response
			// It's only sent via email to prevent attackers from seeing it
			expect(response.body).not.toHaveProperty("dns_record_value");

			// DNS record name should be _vetchium-verify.<domain>
			expect(response.body.dns_record_name).toMatch(/^_vetchium-verify\..+$/);

			// Token expiry should be a valid ISO 8601 timestamp
			const expiryDate = new Date(response.body.token_expires_at);
			expect(expiryDate.getTime()).toBeGreaterThan(Date.now());

			// Wait for BOTH emails (DNS instructions + signup token)
			const emails = await waitForBothSignupEmails(userEmail);
			expect(emails.length).toBeGreaterThanOrEqual(2);

			// Get full content of both emails
			const emailContents = await Promise.all(
				emails.map((msg) => getEmailContent(msg.ID))
			);

			// Find the DNS instructions email (contains dns_record_name)
			const dnsEmail = emailContents.find(
				(email) =>
					email.HTML.includes(response.body.dns_record_name) &&
					email.Subject.includes("DNS")
			);
			expect(dnsEmail).toBeDefined();
			expect(dnsEmail!.To[0].Address).toBe(userEmail);

			// DNS email should contain the DNS record value (64-char hex token)
			const dnsTokenMatch = dnsEmail!.Text.match(/\b([a-f0-9]{64})\b/);
			expect(dnsTokenMatch).toBeTruthy();
			const dnsVerificationToken = dnsTokenMatch![1];

			// Find the signup token email (contains "Private Link" or "DO NOT FORWARD")
			const tokenEmail = emailContents.find(
				(email) =>
					email.Subject.includes("Private Link") ||
					email.Text.includes("DO NOT FORWARD")
			);
			expect(tokenEmail).toBeDefined();
			expect(tokenEmail!.To[0].Address).toBe(userEmail);

			// Token email should contain a different 64-char hex token (signup token)
			const signupToken = extractAgencySignupToken(tokenEmail!.Text);
			expect(signupToken).toMatch(/^[a-f0-9]{64}$/);

			// The two tokens should be DIFFERENT (DNS token vs signup token)
			expect(signupToken).not.toBe(dnsVerificationToken);

			// DNS email should NOT contain the signup token
			expect(dnsEmail!.Text).not.toContain(signupToken);
			expect(dnsEmail!.HTML).not.toContain(signupToken);

			// Token email should NOT contain the DNS verification token
			expect(tokenEmail!.Text).not.toContain(dnsVerificationToken);
			expect(tokenEmail!.HTML).not.toContain(dnsVerificationToken);
		} finally {
			// No cleanup needed - user not fully registered
		}
	});

	test("signup works with different regions", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const regions = ["ind1", "usa1", "deu1"];

		for (const region of regions) {
			const { email: userEmail } = generateTestAgencyEmail(`signup-${region}`);

			const initRequest: AgencyInitSignupRequest = {
				email: userEmail,
				home_region: region,
			};
			const response = await api.initSignup(initRequest);

			expect(response.status).toBe(200);
			expect(response.body.domain).toBeDefined();
			expect(response.body.dns_record_name).toBeDefined();
			// dns_record_value is no longer in the response (security fix)
			expect(response.body).not.toHaveProperty("dns_record_value");

			// Verify both emails were sent
			const emails = await waitForBothSignupEmails(userEmail);
			expect(emails.length).toBeGreaterThanOrEqual(2);
		}
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.initSignupRaw({
			email: "not-an-email",
			home_region: "ind1",
		});

		expect(response.status).toBe(400);
	});

	test("missing email returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.initSignupRaw({
			home_region: "ind1",
		});

		expect(response.status).toBe(400);
	});

	test("empty email returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.initSignupRaw({
			email: "",
			home_region: "ind1",
		});

		expect(response.status).toBe(400);
	});

	test("missing home_region returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: userEmail } = generateTestAgencyEmail("missing-region");

		const response = await api.initSignupRaw({
			email: userEmail,
		});

		expect(response.status).toBe(400);
	});

	test("invalid home_region returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: userEmail } = generateTestAgencyEmail("invalid-region");

		const response = await api.initSignupRaw({
			email: userEmail,
			home_region: "invalid_region",
		});

		expect(response.status).toBe(400);
	});

	test("same domain pending signup returns 409", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		// Use unique domain prefix but same domain for both emails
		const domain = `dup-domain-${Date.now()}.test.com`;
		const userEmail1 = `user1@${domain}`;
		const userEmail2 = `user2@${domain}`;

		try {
			// First signup for the domain
			const initRequest1: AgencyInitSignupRequest = {
				email: userEmail1,
				home_region: "ind1",
			};
			const response1 = await api.initSignup(initRequest1);
			expect(response1.status).toBe(200);

			// Wait for email to confirm first signup succeeded
			await waitForEmail(userEmail1);

			// Second signup for the same domain should fail with 409
			const initRequest2: AgencyInitSignupRequest = {
				email: userEmail2,
				home_region: "ind1",
			};
			const response2 = await api.initSignup(initRequest2);
			expect(response2.status).toBe(409);
		} finally {
			// No cleanup needed - users not fully registered
		}
	});

	// Personal email domain blocking tests
	test.describe("personal email domain blocking", () => {
		test("gmail.com email returns 400 with validation error", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const response = await api.initSignupRaw({
				email: "testuser@gmail.com",
				home_region: "ind1",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
			expect(response.errors).toBeInstanceOf(Array);
			expect(response.errors!.length).toBeGreaterThan(0);

			const emailError = response.errors!.find(
				(e: { field: string }) => e.field === "email"
			);
			expect(emailError).toBeDefined();
			expect(emailError!.message).toContain("personal email");
		});

		test("yahoo.com email returns 400 with validation error", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const response = await api.initSignupRaw({
				email: "testuser@yahoo.com",
				home_region: "ind1",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
			expect(response.errors!.length).toBeGreaterThan(0);

			const emailError = response.errors!.find(
				(e: { field: string }) => e.field === "email"
			);
			expect(emailError).toBeDefined();
			expect(emailError!.message).toContain("personal email");
		});

		test("hotmail.com email returns 400 with validation error", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const response = await api.initSignupRaw({
				email: "testuser@hotmail.com",
				home_region: "ind1",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();

			const emailError = response.errors!.find(
				(e: { field: string }) => e.field === "email"
			);
			expect(emailError).toBeDefined();
			expect(emailError!.message).toContain("personal email");
		});

		test("outlook.com email returns 400 with validation error", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const response = await api.initSignupRaw({
				email: "testuser@outlook.com",
				home_region: "ind1",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();

			const emailError = response.errors!.find(
				(e: { field: string }) => e.field === "email"
			);
			expect(emailError).toBeDefined();
			expect(emailError!.message).toContain("personal email");
		});

		test("protonmail.com email returns 400 with validation error", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const response = await api.initSignupRaw({
				email: "testuser@protonmail.com",
				home_region: "ind1",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();

			const emailError = response.errors!.find(
				(e: { field: string }) => e.field === "email"
			);
			expect(emailError).toBeDefined();
			expect(emailError!.message).toContain("personal email");
		});

		test("icloud.com email returns 400 with validation error", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const response = await api.initSignupRaw({
				email: "testuser@icloud.com",
				home_region: "ind1",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();

			const emailError = response.errors!.find(
				(e: { field: string }) => e.field === "email"
			);
			expect(emailError).toBeDefined();
			expect(emailError!.message).toContain("personal email");
		});

		// Test all personal email domains from the list
		test("all personal email domains in PERSONAL_EMAIL_DOMAINS are blocked", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Test a representative sample of domains from the list
			const sampleDomains = [
				"gmail.com",
				"googlemail.com",
				"yahoo.com",
				"yahoo.co.uk",
				"hotmail.com",
				"outlook.com",
				"live.com",
				"aol.com",
				"protonmail.com",
				"proton.me",
				"icloud.com",
				"me.com",
				"zoho.com",
				"yandex.com",
				"gmx.com",
				"web.de",
				"fastmail.com",
				"tutanota.com",
			];

			for (const domain of sampleDomains) {
				const response = await api.initSignupRaw({
					email: `testuser@${domain}`,
					home_region: "ind1",
				});

				expect(response.status).toBe(400);
				expect(response.errors).toBeDefined();

				const emailError = response.errors!.find(
					(e: { field: string }) => e.field === "email"
				);
				expect(emailError).toBeDefined();
				expect(emailError!.message).toContain("personal email");
			}
		});

		test("personal email domain check is case-insensitive", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			// Test with uppercase domain
			const response = await api.initSignupRaw({
				email: "testuser@GMAIL.COM",
				home_region: "ind1",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();

			const emailError = response.errors!.find(
				(e: { field: string }) => e.field === "email"
			);
			expect(emailError).toBeDefined();
			expect(emailError!.message).toContain("personal email");
		});

		test("personal email domain check works with mixed case", async ({
			request,
		}) => {
			const api = new AgencyAPIClient(request);

			const response = await api.initSignupRaw({
				email: "TestUser@Gmail.Com",
				home_region: "ind1",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();

			const emailError = response.errors!.find(
				(e: { field: string }) => e.field === "email"
			);
			expect(emailError).toBeDefined();
			expect(emailError!.message).toContain("personal email");
		});

		test("company email domain is allowed", async ({ request }) => {
			const api = new AgencyAPIClient(request);
			// Use unique domain for each test to avoid 409 conflicts
			const { email: userEmail } = generateTestAgencyEmail("company-email");

			const initRequest: AgencyInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const response = await api.initSignup(initRequest);

			// Should succeed - company domains are allowed
			expect(response.status).toBe(200);
			expect(response.body.domain).toBeDefined();
			expect(response.body.dns_record_name).toBeDefined();
		});

		test("custom company domain is allowed", async ({ request }) => {
			const api = new AgencyAPIClient(request);

			// Use a random company domain that's not in the blocked list
			const response = await api.initSignupRaw({
				email: "hr@acme-corporation.com",
				home_region: "ind1",
			});

			// Should succeed - custom company domains are allowed
			expect(response.status).toBe(200);
		});
	});
});
