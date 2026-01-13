import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { generateTestEmail } from "../../../lib/db";
import { waitForEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgInitSignupRequest,
	OrgCompleteSignupRequest,
} from "vetchium-specs/org/org-users";

test.describe("POST /org/complete-signup", () => {
	// NOTE: Successful signup completion requires actual DNS verification.
	// In a real test environment, you would need either:
	// 1. A mock DNS server that returns expected TXT records
	// 2. A test mode that bypasses DNS verification
	// 3. Actually setting up DNS records for test domains
	//
	// For now, we test the validation and error cases that don't require DNS.

	test("no pending signup returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const userEmail = generateTestEmail("no-pending");

		// Try to complete signup without init-signup first
		const completeRequest: OrgCompleteSignupRequest = {
			email: userEmail,
			password: TEST_PASSWORD,
		};
		const response = await api.completeSignup(completeRequest);

		expect(response.status).toBe(404);
	});

	test("missing email returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.completeSignupRaw({
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("missing password returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const userEmail = generateTestEmail("missing-pwd");

		const response = await api.completeSignupRaw({
			email: userEmail,
		});

		expect(response.status).toBe(400);
	});

	test("empty email returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.completeSignupRaw({
			email: "",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("empty password returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const userEmail = generateTestEmail("empty-pwd");

		const response = await api.completeSignupRaw({
			email: userEmail,
			password: "",
		});

		expect(response.status).toBe(400);
	});

	test("weak password returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const userEmail = generateTestEmail("weak-pwd");

		// Password doesn't meet requirements (too short, no special char, etc.)
		const response = await api.completeSignupRaw({
			email: userEmail,
			password: "weak",
		});

		expect(response.status).toBe(400);
	});

	test("invalid email format returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.completeSignupRaw({
			email: "not-an-email",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
	});

	test("personal email domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const response = await api.completeSignupRaw({
			email: "testuser@gmail.com",
			password: TEST_PASSWORD,
		});

		expect(response.status).toBe(400);
		expect(response.errors).toBeDefined();

		const emailError = response.errors!.find(
			(e: { field: string }) => e.field === "email"
		);
		expect(emailError).toBeDefined();
		expect(emailError!.message).toContain("personal email");
	});

	test("DNS verification failure returns 422", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const userEmail = generateTestEmail("dns-fail");

		try {
			// Init signup first
			const initRequest: OrgInitSignupRequest = {
				email: userEmail,
				home_region: "ind1",
			};
			const initResponse = await api.initSignup(initRequest);
			expect(initResponse.status).toBe(200);

			// Wait for email to confirm init succeeded
			await waitForEmail(userEmail);

			// Try to complete signup - DNS verification will fail
			// because there's no actual DNS record for the test domain
			const completeRequest: OrgCompleteSignupRequest = {
				email: userEmail,
				password: TEST_PASSWORD,
			};
			const response = await api.completeSignup(completeRequest);

			// Should fail with 422 because DNS verification fails
			expect(response.status).toBe(422);
		} finally {
			// No cleanup needed - user not fully registered
		}
	});
});
