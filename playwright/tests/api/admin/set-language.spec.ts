import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

/**
 * Helper to perform full login flow and get session token.
 */
async function getSessionToken(
	api: AdminAPIClient,
	email: string,
	password: string
): Promise<string> {
	// Login
	const loginResponse = await api.login({ email, password });
	expect(loginResponse.status).toBe(200);
	const tfaToken = loginResponse.body.tfa_token;

	// Get TFA code from email
	const tfaCode = await getTfaCodeFromEmail(email);

	// Verify TFA
	const tfaResponse = await api.verifyTFA({
		tfa_token: tfaToken,
		tfa_code: tfaCode,
	});
	expect(tfaResponse.status).toBe(200);

	return tfaResponse.body.session_token;
}

test.describe("POST /admin/set-language", () => {
	test("valid language update returns 200", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("setlang-success");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			const response = await api.setLanguage(sessionToken, {
				language: "de-DE",
			});

			expect(response.status).toBe(200);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("missing Authorization header returns 401", async ({ request }) => {
		const response = await request.post("/admin/set-language", {
			data: { language: "de-DE" },
		});

		expect(response.status()).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.setLanguage(
			"0000000000000000000000000000000000000000000000000000000000000000",
			{ language: "de-DE" }
		);

		expect(response.status).toBe(401);
	});

	test("missing language returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("setlang-missing");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			const response = await api.setLanguageRaw(sessionToken, {});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
			expect(response.errors?.length).toBeGreaterThan(0);
			expect(response.errors?.[0].field).toBe("language");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("invalid language code returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("setlang-invalid");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			const response = await api.setLanguageRaw(sessionToken, {
				language: "invalid-code",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
			expect(response.errors?.length).toBeGreaterThan(0);
			expect(response.errors?.[0].field).toBe("language");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("empty language code returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("setlang-empty");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			const response = await api.setLanguageRaw(sessionToken, {
				language: "",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
			expect(response.errors?.length).toBeGreaterThan(0);
			expect(response.errors?.[0].field).toBe("language");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("unsupported language code returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("setlang-unsupported");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			// Valid format but not in supported languages list
			const response = await api.setLanguageRaw(sessionToken, {
				language: "fr-FR",
			});

			expect(response.status).toBe(400);
			expect(response.errors).toBeDefined();
			expect(response.errors?.length).toBeGreaterThan(0);
			expect(response.errors?.[0].field).toBe("language");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("update to different supported languages returns 200", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("setlang-multi");
		const password = TEST_PASSWORD;

		await createTestAdminUser(email, password);
		try {
			const sessionToken = await getSessionToken(api, email, password);

			// Update to German
			const response1 = await api.setLanguage(sessionToken, {
				language: "de-DE",
			});
			expect(response1.status).toBe(200);

			// Update to Tamil
			const response2 = await api.setLanguage(sessionToken, {
				language: "ta-IN",
			});
			expect(response2.status).toBe(200);

			// Update back to English
			const response3 = await api.setLanguage(sessionToken, {
				language: "en-US",
			});
			expect(response3.status).toBe(200);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});
