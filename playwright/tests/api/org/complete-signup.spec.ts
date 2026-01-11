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
	getTestOrgUser,
} from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgInitSignupRequest,
	OrgCompleteSignupRequest,
} from "vetchium-specs/org/org-users";

test.describe("POST /org/complete-signup", () => {
	test("successful signup completion returns session token", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("complete-signup");
		const adminEmail = generateTestEmail("complete-signup-admin");

		// Create admin user and approved domain
		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		// Email with the approved domain
		const userEmail = `complete-${Date.now()}@${domainName}`;

		try {
			// Init signup first
			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const initResponse = await api.initSignup(initRequest);
			expect(initResponse.status).toBe(200);

			// Wait for email and extract token
			const emailMessage = await waitForEmail(userEmail);
			const fullEmail = await getEmailContent(emailMessage.ID);
			const tokenMatch = fullEmail.HTML.match(/token=([a-f0-9]{64})/);
			expect(tokenMatch).toBeDefined();
			const signupToken = tokenMatch![1];

			// Complete signup
			const completeRequest: OrgCompleteSignupRequest = {
				signup_token: signupToken,
				password: TEST_PASSWORD,
			};
			const response = await api.completeSignup(completeRequest);

			expect(response.status).toBe(201);
			expect(response.body.session_token).toBeDefined();
			expect(response.body.org_user_id).toBeDefined();

			// Session token should be region-prefixed (e.g., "IND1-...")
			expect(response.body.session_token).toMatch(/^[A-Z]{3}\d-[a-f0-9]{64}$/);

			// Verify user was created in database
			const dbUser = await getTestOrgUser(userEmail);
			expect(dbUser).toBeDefined();
			expect(dbUser?.status).toBe("active");
		} finally {
			// Cleanup
			await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("invalid token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const completeRequest: OrgCompleteSignupRequest = {
			signup_token: "a".repeat(64), // Valid format but non-existent token
			password: TEST_PASSWORD,
		};
		const response = await api.completeSignup(completeRequest);

		expect(response.status).toBe(401);
	});

	test("missing signup_token returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.completeSignupRaw({
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("missing password returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.completeSignupRaw({
			signup_token: "a".repeat(64),
		});

		expect(response.status).toBe(400);
	});

	test("empty signup_token returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.completeSignupRaw({
			signup_token: "",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("empty password returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.completeSignupRaw({
			signup_token: "a".repeat(64),
			password: "",
		});

		expect(response.status).toBe(400);
	});

	test("weak password returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		// Password doesn't meet requirements (too short, no special char, etc.)
		const response = await api.completeSignupRaw({
			signup_token: "a".repeat(64),
			password: "weak",
		});

		expect(response.status).toBe(400);
	});

	test("reusing token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const domainName = generateTestDomainName("reuse-token");
		const adminEmail = generateTestEmail("reuse-token-admin");

		// Create admin user and approved domain
		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domainName, adminEmail);

		// Email with the approved domain
		const userEmail = `reuse-${Date.now()}@${domainName}`;

		try {
			// Init signup first
			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const initResponse = await api.initSignup(initRequest);
			expect(initResponse.status).toBe(200);

			// Wait for email and extract token
			const emailMessage = await waitForEmail(userEmail);
			const fullEmail = await getEmailContent(emailMessage.ID);
			const tokenMatch = fullEmail.HTML.match(/token=([a-f0-9]{64})/);
			expect(tokenMatch).toBeDefined();
			const signupToken = tokenMatch![1];

			// First complete signup
			const completeRequest: OrgCompleteSignupRequest = {
				signup_token: signupToken,
				password: TEST_PASSWORD,
			};
			const response1 = await api.completeSignup(completeRequest);
			expect(response1.status).toBe(201);

			// Try to reuse the same token - returns 409 because email is already registered
			const response2 = await api.completeSignup(completeRequest);
			expect(response2.status).toBe(409);
		} finally {
			// Cleanup
			await deleteTestOrgUser(userEmail);
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
