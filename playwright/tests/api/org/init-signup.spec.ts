import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { generateTestEmail, deleteTestOrgUser } from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type { OrgInitSignupRequest } from "vetchium-specs/org/org-users";

test.describe("POST /org/init-signup", () => {
	test("successful signup sends verification email for any domain", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		// Use any random domain - org signup should work for any domain
		const userEmail = generateTestEmail("init-signup");

		try {
			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const response = await api.initSignup(initRequest);

			expect(response.status).toBe(200);
			expect(response.body.message).toBeDefined();

			// Verify email was sent
			const emailMessage = await waitForEmail(userEmail);
			expect(emailMessage).toBeDefined();
			expect(emailMessage.To[0].Address).toBe(userEmail);

			// Check email contains signup link with token
			const fullEmail = await getEmailContent(emailMessage.ID);
			expect(fullEmail.HTML).toContain("token=");
			const tokenMatch = fullEmail.HTML.match(/token=([a-f0-9]{64})/);
			expect(tokenMatch).toBeDefined();
		} finally {
			// No cleanup needed - user not fully registered
		}
	});

	test("signup works with different regions", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const regions = ["ind1", "usa1", "deu1"];

		for (const region of regions) {
			const userEmail = generateTestEmail(`signup-${region}`);

			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: region,
			};
			const response = await api.initSignup(initRequest);

			expect(response.status).toBe(200);
			expect(response.body.message).toBeDefined();

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
		const userEmail = generateTestEmail("missing-region");

		const response = await api.initSignupRaw({
			email: userEmail,
		});

		expect(response.status).toBe(400);
	});

	test("invalid home_region returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const userEmail = generateTestEmail("invalid-region");

		const response = await api.initSignupRaw({
			email: userEmail,
			home_region: "invalid_region",
		});

		expect(response.status).toBe(400);
	});

	test("duplicate signup returns 409", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const userEmail = generateTestEmail("dup-signup");

		try {
			// First signup
			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const response1 = await api.initSignup(initRequest);
			expect(response1.status).toBe(200);

			// Wait for email
			const emailMessage = await waitForEmail(userEmail);
			const fullEmail = await getEmailContent(emailMessage.ID);
			const tokenMatch = fullEmail.HTML.match(/token=([a-f0-9]{64})/);
			expect(tokenMatch).toBeDefined();
			const signupToken = tokenMatch![1];

			// Complete signup to register the user
			const completeResponse = await api.completeSignup({
				signup_token: signupToken,
				password: TEST_PASSWORD,
			});
			expect(completeResponse.status).toBe(201);

			// Try to signup again with same email
			const response2 = await api.initSignup(initRequest);
			expect(response2.status).toBe(409);
		} finally {
			// Cleanup
			await deleteTestOrgUser(userEmail);
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
			const userEmail = generateTestEmail("company-email");

			// This uses test.vetchium.com which is a company domain
			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const response = await api.initSignup(initRequest);

			// Should succeed - company domains are allowed
			expect(response.status).toBe(200);
			expect(response.body.message).toBeDefined();
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
