import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import { generateTestAgencyEmail } from "../../../lib/db";
import { getAgencySignupTokenFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AgencyInitSignupRequest,
	AgencyCompleteSignupRequest,
} from "vetchium-specs/agency/agency-users";

test.describe("First user admin rights - Agency Portal", () => {
	test("first user completing signup gets admin rights and roles", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		// Use example.com domain for DEV environment (skips DNS verification)
		const { email: userEmail } = generateTestAgencyEmail(
			"first-admin",
			"example.com"
		);

		try {
			// Init signup
			const initRequest: AgencyInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const initResponse = await api.initSignup(initRequest);
			expect(initResponse.status).toBe(200);

			// Get signup token from email
			const signupToken = await getAgencySignupTokenFromEmail(userEmail);
			expect(signupToken).toMatch(/^[a-f0-9]{64}$/);

			// Complete signup (DNS verification skipped for example.com in DEV)
			const completeRequest: AgencyCompleteSignupRequest = {
				signup_token: signupToken,
				password: TEST_PASSWORD,
				preferred_language: "en-US",
				has_added_dns_record: true,
				agrees_to_eula: true,
			};
			const completeResponse = await api.completeSignup(completeRequest);
			expect(completeResponse.status).toBe(201);
			expect(completeResponse.body.session_token).toBeDefined();
			expect(completeResponse.body.agency_user_id).toBeDefined();

			const sessionToken = completeResponse.body.session_token;

			// Get user info to verify admin rights
			const myInfoResponse = await api.getMyInfo(sessionToken);
			expect(myInfoResponse.status).toBe(200);

			// First user should have exactly the superadmin role
			expect(myInfoResponse.body.roles).toContain("agency:superadmin");
			expect(myInfoResponse.body.roles.length).toBe(1);
		} finally {
			// Cleanup is handled by database cascading deletes
		}
	});
});
