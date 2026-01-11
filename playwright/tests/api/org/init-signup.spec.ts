import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
	generateTestEmail,
	generateTestDomainName,
	deleteTestOrgUser,
} from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type { OrgInitSignupRequest } from "vetchium-specs/org/org-users";

test.describe("POST /org/init-signup", () => {
	test("successful signup sends verification email", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("init-signup");
		const adminEmail = generateTestEmail("init-signup-admin");

		// Create admin user and approved domain
		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		// Email with the approved domain
		const userEmail = `user-${Date.now()}@${domainName}`;

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
			// Cleanup in reverse order
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("unapproved domain returns 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		// Use a domain that is not approved
		const email = `test-${Date.now()}@unapproved-domain-${Date.now()}.com`;

		const initRequest: OrgInitSignupRequest = {
			email: email,
			home_region: "ind1",
		};
		const response = await api.initSignup(initRequest);

		expect(response.status).toBe(403);
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.initSignupRaw({
			email: "not-an-email",
		});

		expect(response.status).toBe(400);
	});

	test("missing email returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.initSignupRaw({});

		expect(response.status).toBe(400);
	});

	test("empty email returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.initSignupRaw({
			email: "",
		});

		expect(response.status).toBe(400);
	});

	test("duplicate signup returns 409", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("dup-signup");
		const adminEmail = generateTestEmail("dup-signup-admin");

		// Create admin user and approved domain
		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		// Email with the approved domain
		const userEmail = `dup-user-${Date.now()}@${domainName}`;

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
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
