import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import { deleteTestEmployerByDomain } from "../../../lib/db";
import { getOrgSignupTokenFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import { randomUUID } from "crypto";
import type {
	OrgInitSignupRequest,
	OrgCompleteSignupRequest,
} from "vetchium-specs/employer/employer-users";

const TEST_DOMAIN = "example.com";

test.describe("First user admin rights - Org Portal", () => {
	test("first user completing signup gets admin rights and roles", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		// Use a unique local part so mailpit can find the right email,
		// but keep the domain as example.com which DEV skips DNS verification for.
		const userEmail = `first-admin-${randomUUID().substring(0, 8)}@${TEST_DOMAIN}`;

		// Pre-cleanup: remove any lingering example.com employer from a previous run
		await deleteTestEmployerByDomain(TEST_DOMAIN);

		try {
			// Init signup
			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const initResponse = await api.initSignup(initRequest);
			expect(initResponse.status).toBe(200);

			// Get signup token from email
			const signupToken = await getOrgSignupTokenFromEmail(userEmail);
			expect(signupToken).toMatch(/^[a-f0-9]{64}$/);

			// Complete signup (DNS verification skipped for example.com in DEV)
			const completeRequest: OrgCompleteSignupRequest = {
				signup_token: signupToken,
				password: TEST_PASSWORD,
				preferred_language: "en-US",
				has_added_dns_record: true,
				agrees_to_eula: true,
			};
			const completeResponse = await api.completeSignup(completeRequest);
			expect(completeResponse.status).toBe(201);
			expect(completeResponse.body.session_token).toBeDefined();
			expect(completeResponse.body.org_user_id).toBeDefined();

			const sessionToken = completeResponse.body.session_token;

			// Get user info to verify admin rights
			const myInfoResponse = await api.getMyInfo(sessionToken);
			expect(myInfoResponse.status).toBe(200);

			// First user should have exactly the superadmin role
			expect(myInfoResponse.body.roles).toContain("employer:superadmin");
			expect(myInfoResponse.body.roles.length).toBe(1);
		} finally {
			await deleteTestEmployerByDomain(TEST_DOMAIN);
		}
	});
});
