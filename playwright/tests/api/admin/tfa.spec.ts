import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	LanguageCode,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";

test.describe("POST /admin/tfa", () => {
	test("valid TFA code returns session token and preferred_language", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("tfa-success");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Step 1: Login to get TFA token
			const loginResponse = await api.login(email, password);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Step 2: Get TFA code from email (uses exponential backoff)
			const tfaCode = await getTfaCodeFromEmail(email);
			expect(tfaCode).toMatch(/^\d{6}$/);

			// Step 3: Verify TFA code
			const tfaResponse = await api.verifyTFA(tfaToken, tfaCode);

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.session_token).toBeDefined();
			// Session token should be 64-character hex string (32 bytes hex-encoded)
			expect(tfaResponse.body.session_token).toMatch(/^[a-f0-9]{64}$/);
			// Default preferred_language should be en-US
			expect(tfaResponse.body.preferred_language).toBe("en-US");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("invalid TFA token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.verifyTFA(
			"0000000000000000000000000000000000000000000000000000000000000000",
			"123456"
		);

		expect(response.status).toBe(401);
	});

	test("wrong TFA code returns 403", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("tfa-wrong-code");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login to get TFA token
			const loginResponse = await api.login(email, password);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Try with wrong code
			const tfaResponse = await api.verifyTFA(tfaToken, "000000");

			expect(tfaResponse.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("missing tfa_token returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_code: "123456",
		});

		expect(response.status).toBe(400);
	});

	test("missing tfa_code returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
		});

		expect(response.status).toBe(400);
	});

	test("invalid TFA code format (not 6 digits) returns 400", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);

		// Code too short
		const response1 = await api.verifyTFARaw({
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "12345",
		});
		expect(response1.status).toBe(400);

		// Code too long
		const response2 = await api.verifyTFARaw({
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "1234567",
		});
		expect(response2.status).toBe(400);

		// Code with letters
		const response3 = await api.verifyTFARaw({
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "12345a",
		});
		expect(response3.status).toBe(400);
	});

	test("empty tfa_token returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token: "",
			tfa_code: "123456",
		});

		expect(response.status).toBe(400);
	});

	test("empty tfa_code returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.verifyTFARaw({
			tfa_token:
				"0000000000000000000000000000000000000000000000000000000000000000",
			tfa_code: "",
		});

		expect(response.status).toBe(400);
	});

	test("TFA token can be reused for retry", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("tfa-retry");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login to get TFA token
			const loginResponse = await api.login(email, password);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			// Get correct TFA code (uses exponential backoff)
			const tfaCode = await getTfaCodeFromEmail(email);

			// First attempt with wrong code
			const wrongResponse = await api.verifyTFA(tfaToken, "000000");
			expect(wrongResponse.status).toBe(403);

			// Second attempt with correct code should still work
			const correctResponse = await api.verifyTFA(tfaToken, tfaCode);
			expect(correctResponse.status).toBe(200);
			expect(correctResponse.body.session_token).toBeDefined();
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("TFA response returns German (de-DE) preferred_language", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("tfa-lang-de");
		const password = "Password123$";

		await createTestAdminUser(email, password, { preferredLanguage: "de-DE" });
		try {
			const loginResponse = await api.login(email, password);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(tfaToken, tfaCode);

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.preferred_language).toBe("de-DE");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("TFA response returns Tamil (ta-IN) preferred_language", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("tfa-lang-ta");
		const password = "Password123$";

		await createTestAdminUser(email, password, { preferredLanguage: "ta-IN" });
		try {
			const loginResponse = await api.login(email, password);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(tfaToken, tfaCode);

			expect(tfaResponse.status).toBe(200);
			expect(tfaResponse.body.preferred_language).toBe("ta-IN");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("TFA response returns stored preferred_language for unsupported language", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("tfa-lang-unsupported");
		const password = "Password123$";

		// Create user with unsupported language - API should still return what's stored
		await createTestAdminUser(email, password, {
			preferredLanguage: "fr-FR" as LanguageCode,
		});
		try {
			const loginResponse = await api.login(email, password);
			expect(loginResponse.status).toBe(200);
			const tfaToken = loginResponse.body.tfa_token;

			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(tfaToken, tfaCode);

			expect(tfaResponse.status).toBe(200);
			// The API should return the stored language preference
			expect(tfaResponse.body.preferred_language).toBe("fr-FR");
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});
