import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import { generateTestAgencyEmail } from "../../../lib/db";
import { getAgencySignupTokenFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AgencyInitSignupRequest,
	AgencyCompleteSignupRequest,
} from "vetchium-specs/agency/agency-users";

test.describe("POST /agency/complete-signup", () => {
	// NOTE: Successful signup completion requires actual DNS verification.
	// In a real test environment, you would need either:
	// 1. A mock DNS server that returns expected TXT records
	// 2. A test mode that bypasses DNS verification
	// 3. Actually setting up DNS records for test domains
	//
	// For now, we test the validation and error cases that don't require DNS.

	test("invalid/unknown signup_token returns 404", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		// Try to complete signup with an unknown token
		const completeRequest: AgencyCompleteSignupRequest = {
			signup_token: "0".repeat(64), // Valid format but doesn't exist
			password: TEST_PASSWORD,
			preferred_language: "en-US",
			has_added_dns_record: true,
			agrees_to_eula: true,
		};
		const response = await api.completeSignup(completeRequest);

		expect(response.status).toBe(404);
	});

	test("missing signup_token returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.completeSignupRaw({
			password: TEST_PASSWORD,
			preferred_language: "en-US",
			has_added_dns_record: true,
			agrees_to_eula: true,
		});

		expect(response.status).toBe(400);
	});

	test("missing password returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.completeSignupRaw({
			signup_token: "0".repeat(64),
			preferred_language: "en-US",
			has_added_dns_record: true,
			agrees_to_eula: true,
		});

		expect(response.status).toBe(400);
	});

	test("empty signup_token returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.completeSignupRaw({
			signup_token: "",
			password: TEST_PASSWORD,
			preferred_language: "en-US",
			has_added_dns_record: true,
			agrees_to_eula: true,
		});

		expect(response.status).toBe(400);
	});

	test("empty password returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.completeSignupRaw({
			signup_token: "0".repeat(64),
			password: "",
			preferred_language: "en-US",
			has_added_dns_record: true,
			agrees_to_eula: true,
		});

		expect(response.status).toBe(400);
	});

	test("weak password returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		// Password doesn't meet requirements (too short, no special char, etc.)
		const response = await api.completeSignupRaw({
			signup_token: "0".repeat(64),
			password: "weak",
			preferred_language: "en-US",
			has_added_dns_record: true,
			agrees_to_eula: true,
		});

		expect(response.status).toBe(400);
	});

	test("missing preferred_language returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.completeSignupRaw({
			signup_token: "0".repeat(64),
			password: TEST_PASSWORD,
			has_added_dns_record: true,
			agrees_to_eula: true,
		});

		expect(response.status).toBe(400);
	});

	test("invalid preferred_language with non-existent token returns 404", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);

		// Using fake token - DB lookup fails before language validation
		const response = await api.completeSignupRaw({
			signup_token: "0".repeat(64),
			password: TEST_PASSWORD,
			preferred_language: "invalid-lang",
			has_added_dns_record: true,
			agrees_to_eula: true,
		});

		expect(response.status).toBe(404);
	});

	test("has_added_dns_record=false returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.completeSignupRaw({
			signup_token: "0".repeat(64),
			password: TEST_PASSWORD,
			preferred_language: "en-US",
			has_added_dns_record: false,
			agrees_to_eula: true,
		});

		expect(response.status).toBe(400);
	});

	test("agrees_to_eula=false returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const response = await api.completeSignupRaw({
			signup_token: "0".repeat(64),
			password: TEST_PASSWORD,
			preferred_language: "en-US",
			has_added_dns_record: true,
			agrees_to_eula: false,
		});

		expect(response.status).toBe(400);
	});

	test("DNS verification failure returns 422", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: userEmail } = generateTestAgencyEmail("dns-fail");

		try {
			// Init signup first
			const initRequest: AgencyInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const initResponse = await api.initSignup(initRequest);
			expect(initResponse.status).toBe(200);

			// Get the signup token from the email
			const signupToken = await getAgencySignupTokenFromEmail(userEmail);
			expect(signupToken).toMatch(/^[a-f0-9]{64}$/);

			// Try to complete signup - DNS verification will fail
			// because there's no actual DNS record for the test domain
			const completeRequest: AgencyCompleteSignupRequest = {
				signup_token: signupToken,
				password: TEST_PASSWORD,
				preferred_language: "en-US",
				has_added_dns_record: true,
				agrees_to_eula: true,
			};
			const response = await api.completeSignup(completeRequest);

			// Should fail with 422 because DNS verification fails
			expect(response.status).toBe(422);
		} finally {
			// No cleanup needed - user not fully registered
		}
	});

	test("token not consumed on DNS failure - can retry", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: userEmail } = generateTestAgencyEmail("token-reuse");

		try {
			// Init signup first
			const initRequest: AgencyInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const initResponse = await api.initSignup(initRequest);
			expect(initResponse.status).toBe(200);

			// Get the signup token from the email
			const signupToken = await getAgencySignupTokenFromEmail(userEmail);

			// First attempt - will fail with 422 (DNS not configured)
			// but token lookup should succeed
			const completeRequest: AgencyCompleteSignupRequest = {
				signup_token: signupToken,
				password: TEST_PASSWORD,
				preferred_language: "en-US",
				has_added_dns_record: true,
				agrees_to_eula: true,
			};
			const firstResponse = await api.completeSignup(completeRequest);
			// DNS verification fails but token is valid
			expect(firstResponse.status).toBe(422);

			// Note: The token is NOT consumed on DNS failure - only on success.
			// So a second attempt should also return 422, not 404.
			const secondResponse = await api.completeSignup(completeRequest);
			expect(secondResponse.status).toBe(422);
		} finally {
			// No cleanup needed - user not fully registered
		}
	});

	test("all supported languages are accepted", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const supportedLanguages = ["en-US", "de-DE", "ta-IN"];

		for (const lang of supportedLanguages) {
			const { email: userEmail } = generateTestAgencyEmail(`lang-${lang}`);

			try {
				// Init signup first
				const initRequest: AgencyInitSignupRequest = {
					email: userEmail,
					home_region: "ind1",
				};
				const initResponse = await api.initSignup(initRequest);
				expect(initResponse.status).toBe(200);

				// Get the signup token from the email
				const signupToken = await getAgencySignupTokenFromEmail(userEmail);

				// Try to complete signup with each supported language
				const completeRequest: AgencyCompleteSignupRequest = {
					signup_token: signupToken,
					password: TEST_PASSWORD,
					preferred_language: lang,
					has_added_dns_record: true,
					agrees_to_eula: true,
				};
				const response = await api.completeSignup(completeRequest);

				// Should fail with 422 (DNS not configured), not 400 (validation error)
				// This confirms the language is accepted
				expect(response.status).toBe(422);
			} finally {
				// No cleanup needed - user not fully registered
			}
		}
	});
});
