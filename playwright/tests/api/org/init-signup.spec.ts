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
});
