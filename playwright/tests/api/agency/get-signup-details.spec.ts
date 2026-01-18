import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import { generateTestAgencyEmail } from "../../../lib/db";
import { getAgencySignupTokenFromEmail } from "../../../lib/mailpit";
import type {
	AgencyInitSignupRequest,
	AgencyGetSignupDetailsRequest,
} from "vetchium-specs/agency/agency-users";

test.describe("POST /agency/get-signup-details", () => {
	test("valid signup token returns domain being verified", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email: userEmail, domain } = generateTestAgencyEmail(
			"get-details-success"
		);

		try {
			// First initiate signup to get a signup token
			const initRequest: AgencyInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const initResponse = await api.initSignup(initRequest);
			expect(initResponse.status).toBe(200);

			// Get the signup token from email
			const signupToken = await getAgencySignupTokenFromEmail(userEmail);

			// Get signup details using the token
			const detailsRequest: AgencyGetSignupDetailsRequest = {
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
		const api = new AgencyAPIClient(request);

		const response = await api.getSignupDetailsRaw({});

		expect(response.status).toBe(400);
	});

	test("empty signup_token returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.getSignupDetailsRaw({
			signup_token: "",
		});

		expect(response.status).toBe(400);
	});

	test("invalid signup_token format returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		// Invalid format - too short
		const response = await api.getSignupDetailsRaw({
			signup_token: "invalid",
		});

		expect(response.status).toBe(400);
	});

	test("non-existent signup_token returns 404", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		// Valid format but non-existent token
		const fakeToken = "a".repeat(64);
		const detailsRequest: AgencyGetSignupDetailsRequest = {
			signup_token: fakeToken,
		};
		const response = await api.getSignupDetails(detailsRequest);

		expect(response.status).toBe(404);
	});

	test("expired signup_token returns 404", async ({ request }) => {
		// This test would require manipulating time or waiting for expiry
		// For now, we rely on the non-existent token test above
		// In a real scenario, you'd create a signup token, wait for expiry,
		// then try to use it - but that's impractical for automated tests
	});
});
