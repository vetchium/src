import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import { generateTestOrgEmail } from "../../../lib/db";
import { getOrgSignupTokenFromEmail } from "../../../lib/mailpit";
import type {
	OrgInitSignupRequest,
	OrgGetSignupDetailsRequest,
} from "vetchium-specs/employer/employer-users";

test.describe("POST /employer/get-signup-details", () => {
	test("valid signup token returns domain being verified", async ({
		request,
	}) => {
		const api = new EmployerAPIClient(request);
		const { email: userEmail, domain } = generateTestOrgEmail(
			"org-get-details-success"
		);

		try {
			// First initiate signup to get a signup token
			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const initResponse = await api.initSignup(initRequest);
			expect(initResponse.status).toBe(200);

			// Get the signup token from email
			const signupToken = await getOrgSignupTokenFromEmail(userEmail);

			// Get signup details using the token
			const detailsRequest: OrgGetSignupDetailsRequest = {
				signup_token: signupToken,
			};
			const response = await api.getSignupDetails(detailsRequest);

			expect(response.status).toBe(200);
			expect(response.body.domain).toBe(domain.toLowerCase());
		} finally {
			// No cleanup needed - user not fully registered
		}
	});

	test("missing signup_token returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.getSignupDetailsRaw({});

		expect(response.status).toBe(400);
	});

	test("empty signup_token returns 400", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const response = await api.getSignupDetailsRaw({
			signup_token: "",
		});

		expect(response.status).toBe(400);
	});

	test("non-existent signup_token returns 404", async ({ request }) => {
		const api = new EmployerAPIClient(request);

		const fakeToken = "a".repeat(64);
		const detailsRequest: OrgGetSignupDetailsRequest = {
			signup_token: fakeToken,
		};
		const response = await api.getSignupDetails(detailsRequest);

		expect(response.status).toBe(404);
	});
});
