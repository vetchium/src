import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { generateTestOrgEmail } from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import type { OrgInitSignupRequest } from "vetchium-specs/org/org-users";

test.describe("POST /org/init-signup", () => {
	test("successful signup returns DNS verification instructions", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		// Use unique domain for each test to avoid 409 conflicts
		const { email: userEmail } = generateTestOrgEmail("init-signup");

		try {
			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const response = await api.initSignup(initRequest);

			expect(response.status).toBe(200);

			// Verify DNS verification response fields
			expect(response.body.domain).toBeDefined();
			expect(response.body.dns_record_name).toBeDefined();
			expect(response.body.dns_record_value).toBeDefined();
			expect(response.body.token_expires_at).toBeDefined();
			expect(response.body.message).toBeDefined();

			// DNS record name should be _vetchium-verify.<domain>
			expect(response.body.dns_record_name).toMatch(/^_vetchium-verify\..+$/);

			// DNS record value should be a 64-character hex token
			expect(response.body.dns_record_value).toMatch(/^[a-f0-9]{64}$/);

			// Token expiry should be a valid ISO 8601 timestamp
			const expiryDate = new Date(response.body.token_expires_at);
			expect(expiryDate.getTime()).toBeGreaterThan(Date.now());

			// Verify email was sent with DNS instructions
			const emailMessage = await waitForEmail(userEmail);
			expect(emailMessage).toBeDefined();
			expect(emailMessage.To[0].Address).toBe(userEmail);

			// Check email contains DNS instructions
			const fullEmail = await getEmailContent(emailMessage.ID);
			expect(fullEmail.HTML).toContain(response.body.dns_record_name);
			expect(fullEmail.HTML).toContain(response.body.dns_record_value);
		} finally {
			// No cleanup needed - user not fully registered
		}
	});

	test("signup works with different regions", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const regions = ["ind1", "usa1", "deu1"];

		for (const region of regions) {
			const { email: userEmail } = generateTestOrgEmail(`signup-${region}`);

			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: region,
			};
			const response = await api.initSignup(initRequest);

			expect(response.status).toBe(200);
			expect(response.body.domain).toBeDefined();
			expect(response.body.dns_record_name).toBeDefined();
			expect(response.body.dns_record_value).toBeDefined();

			// Verify email was sent
			const emailMessage = await waitForEmail(userEmail);
			expect(emailMessage).toBeDefined();
		}
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.initSignupRaw({
			email: "not-an-email",
			home_region: "ind1",
		});

		expect(response.status).toBe(400);
	});

	test("missing email returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.initSignupRaw({
			home_region: "ind1",
		});

		expect(response.status).toBe(400);
	});

	test("empty email returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.initSignupRaw({
			email: "",
			home_region: "ind1",
		});

		expect(response.status).toBe(400);
	});

	test("missing home_region returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: userEmail } = generateTestOrgEmail("missing-region");

		const response = await api.initSignupRaw({
			email: userEmail,
		});

		expect(response.status).toBe(400);
	});

	test("invalid home_region returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: userEmail } = generateTestOrgEmail("invalid-region");

		const response = await api.initSignupRaw({
			email: userEmail,
			home_region: "invalid_region",
		});

		expect(response.status).toBe(400);
	});

	test("same domain pending signup returns 409", async ({ request }) => {
		const api = new OrgAPIClient(request);
		// Use unique domain prefix but same domain for both emails
		const domain = `dup-domain-${Date.now()}.test.com`;
		const userEmail1 = `user1@${domain}`;
		const userEmail2 = `user2@${domain}`;

		try {
			// First signup for the domain
			const initRequest1: OrgInitSignupRequest = {
				email: userEmail1,
				home_region: "ind1",
			};
			const response1 = await api.initSignup(initRequest1);
			expect(response1.status).toBe(200);

			// Wait for email to confirm first signup succeeded
			await waitForEmail(userEmail1);

			// Second signup for the same domain should fail with 409
			const initRequest2: OrgInitSignupRequest = {
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
			const api = new OrgAPIClient(request);

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
			const api = new OrgAPIClient(request);

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
			const api = new OrgAPIClient(request);

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
			const api = new OrgAPIClient(request);

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
			const api = new OrgAPIClient(request);

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
			const api = new OrgAPIClient(request);

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
			const api = new OrgAPIClient(request);

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
			const api = new OrgAPIClient(request);

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
			const api = new OrgAPIClient(request);

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
			const api = new OrgAPIClient(request);
			// Use unique domain for each test to avoid 409 conflicts
			const { email: userEmail } = generateTestOrgEmail("company-email");

			const initRequest: OrgInitSignupRequest = {
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
			const api = new OrgAPIClient(request);

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
