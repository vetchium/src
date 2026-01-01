import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	LanguageCode,
} from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

/**
 * i18n Email Tests
 *
 * These tests verify that emails are sent in the user's preferred language.
 * Each test creates isolated users with unique emails to support parallel execution.
 *
 * Supported languages:
 * - en-US: English (United States) - Default
 * - de-DE: German (Germany)
 * - ta-IN: Tamil (India)
 */

test.describe("Email i18n - Language-specific email content", () => {
	// ==========================================================================
	// English (en-US) Tests - Default Language
	// ==========================================================================

	test.describe("English (en-US)", () => {
		test("TFA email subject is in English for en-US user", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-en-subject");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "en-US",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailMessage = await waitForEmail(email);
				expect(emailMessage.Subject).toContain("Verification Code");
				expect(emailMessage.Subject).toContain("Vetchium");
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("TFA email body is in English for en-US user", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-en-body");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "en-US",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Check English text content
				expect(fullEmail.Text).toContain("Your verification code is:");
				expect(fullEmail.Text).toContain("expire in");
				expect(fullEmail.Text).toContain("minutes");
				expect(fullEmail.Text).toContain("automated message");
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("TFA email HTML body is in English for en-US user", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-en-html");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "en-US",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Check English HTML content
				expect(fullEmail.HTML).toContain("Your verification code is:");
				expect(fullEmail.HTML).toContain('lang="en"');
			} finally {
				await deleteTestAdminUser(email);
			}
		});
	});

	// ==========================================================================
	// German (de-DE) Tests
	// ==========================================================================

	test.describe("German (de-DE)", () => {
		test("TFA email subject is in German for de-DE user", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-de-subject");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "de-DE",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailMessage = await waitForEmail(email);
				// German subject: "Ihr Vetchium Admin Bestaetigungscode"
				expect(emailMessage.Subject).toContain("Bestaetigungscode");
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("TFA email body is in German for de-DE user", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-de-body");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "de-DE",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Check German text content
				expect(fullEmail.Text).toContain("Bestaetigungscode lautet:");
				expect(fullEmail.Text).toContain("Minuten");
				expect(fullEmail.Text).toContain("automatische Nachricht");
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("TFA email HTML body has German lang attribute for de-DE user", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-de-html");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "de-DE",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Check German HTML attributes and content
				expect(fullEmail.HTML).toContain('lang="de"');
				expect(fullEmail.HTML).toContain("Bestaetigungscode");
			} finally {
				await deleteTestAdminUser(email);
			}
		});
	});

	// ==========================================================================
	// Tamil (ta-IN) Tests
	// ==========================================================================

	test.describe("Tamil (ta-IN)", () => {
		test("TFA email subject is in Tamil for ta-IN user", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-ta-subject");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "ta-IN",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailMessage = await waitForEmail(email);
				// Tamil subject contains Tamil Unicode characters
				expect(emailMessage.Subject).toContain("சரிபார்ப்புக் குறியீடு");
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("TFA email body is in Tamil for ta-IN user", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-ta-body");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "ta-IN",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Check Tamil text content
				expect(fullEmail.Text).toContain("சரிபார்ப்புக் குறியீடு:");
				expect(fullEmail.Text).toContain("நிமிடங்களில்");
				expect(fullEmail.Text).toContain("தானியங்கி செய்தி");
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("TFA email HTML body has Tamil lang attribute for ta-IN user", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-ta-html");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "ta-IN",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Check Tamil HTML attributes and content
				expect(fullEmail.HTML).toContain('lang="ta"');
				expect(fullEmail.HTML).toContain("சரிபார்ப்புக் குறியீடு");
			} finally {
				await deleteTestAdminUser(email);
			}
		});
	});

	// ==========================================================================
	// Fallback Behavior Tests
	// ==========================================================================

	test.describe("Language Fallback", () => {
		test("unsupported language falls back to English (fr-FR)", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-fallback-fr");
			const password = TEST_PASSWORD;

			// French is not supported, should fall back to English
			await createTestAdminUser(email, password, {
				preferredLanguage: "fr-FR",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Should be in English (fallback)
				expect(fullEmail.Text).toContain("Your verification code is:");
				expect(fullEmail.Text).not.toContain("Bestaetigungscode");
				expect(fullEmail.Text).not.toContain("சரிபார்ப்புக்");
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("unsupported language falls back to English (ja-JP)", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-fallback-ja");
			const password = TEST_PASSWORD;

			// Japanese is not supported, should fall back to English
			await createTestAdminUser(email, password, {
				preferredLanguage: "ja-JP",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Should be in English (fallback)
				expect(emailSummary.Subject).toContain("Verification Code");
				expect(fullEmail.Text).toContain("Your verification code is:");
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("unsupported regional variant falls back to base language (en-GB to en-US)", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-fallback-en-gb");
			const password = TEST_PASSWORD;

			// en-GB is not explicitly supported, should match en-US
			await createTestAdminUser(email, password, {
				preferredLanguage: "en-GB",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Should be in English (matched to en-US)
				expect(fullEmail.Text).toContain("Your verification code is:");
				expect(fullEmail.HTML).toContain('lang="en"');
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("unsupported German variant falls back to de-DE (de-AT)", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-fallback-de-at");
			const password = TEST_PASSWORD;

			// Austrian German (de-AT) not supported, should fall back to de-DE
			await createTestAdminUser(email, password, {
				preferredLanguage: "de-AT",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Should be in German (matched to de-DE)
				expect(fullEmail.Text).toContain("Bestaetigungscode lautet:");
				expect(fullEmail.HTML).toContain('lang="de"');
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("empty language falls back to English", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-fallback-empty");
			const password = TEST_PASSWORD;

			// Empty language should use default (en-US)
			await createTestAdminUser(email, password, { preferredLanguage: "" });
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Should be in English (default)
				expect(fullEmail.Text).toContain("Your verification code is:");
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("invalid language code falls back to English", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-fallback-invalid");
			const password = TEST_PASSWORD;

			// Invalid language code should use default (en-US)
			await createTestAdminUser(email, password, {
				preferredLanguage: "xyz-123",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Should be in English (default)
				expect(fullEmail.Text).toContain("Your verification code is:");
			} finally {
				await deleteTestAdminUser(email);
			}
		});
	});

	// ==========================================================================
	// Default Language Behavior Tests
	// ==========================================================================

	test.describe("Default Language", () => {
		test("user created without explicit language gets English emails", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-default-lang");
			const password = TEST_PASSWORD;

			// Create user with just status (no explicit language - uses default en-US)
			await createTestAdminUser(email, password, "active");
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Should be in English (default)
				expect(emailSummary.Subject).toContain("Verification Code");
				expect(fullEmail.Text).toContain("Your verification code is:");
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("user created with empty options object gets English emails", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-default-empty-opts");
			const password = TEST_PASSWORD;

			// Create user with empty options (uses defaults)
			await createTestAdminUser(email, password, {});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// Should be in English (default)
				expect(fullEmail.Text).toContain("Your verification code is:");
			} finally {
				await deleteTestAdminUser(email);
			}
		});
	});

	// ==========================================================================
	// Email Content Verification Tests
	// ==========================================================================

	test.describe("Email Content Verification", () => {
		test("TFA code is present in localized English email", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-code-en");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "en-US",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// TFA code should be 6 digits
				const codeMatch = fullEmail.Text.match(/\b(\d{6})\b/);
				expect(codeMatch).not.toBeNull();
				expect(codeMatch![1]).toHaveLength(6);
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("TFA code is present in localized German email", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-code-de");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "de-DE",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// TFA code should be 6 digits
				const codeMatch = fullEmail.Text.match(/\b(\d{6})\b/);
				expect(codeMatch).not.toBeNull();
				expect(codeMatch![1]).toHaveLength(6);
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("TFA code is present in localized Tamil email", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const email = generateTestEmail("i18n-code-ta");
			const password = TEST_PASSWORD;

			await createTestAdminUser(email, password, {
				preferredLanguage: "ta-IN",
			});
			try {
				const response = await api.login({ email: email, password: password });
				expect(response.status).toBe(200);

				const emailSummary = await waitForEmail(email);
				const fullEmail = await getEmailContent(emailSummary.ID);

				// TFA code should be 6 digits
				const codeMatch = fullEmail.Text.match(/\b(\d{6})\b/);
				expect(codeMatch).not.toBeNull();
				expect(codeMatch![1]).toHaveLength(6);
			} finally {
				await deleteTestAdminUser(email);
			}
		});

		test("expiry time is mentioned in all languages", async ({ request }) => {
			// This test verifies the {{.Minutes}} placeholder is replaced correctly
			// Run all 3 languages concurrently to avoid timeout
			const api = new AdminAPIClient(request);
			const password = TEST_PASSWORD;

			const testCases = [
				{
					email: generateTestEmail("i18n-expiry-en"),
					lang: "en-US" as LanguageCode,
					expectedPattern: /10 minutes/,
				},
				{
					email: generateTestEmail("i18n-expiry-de"),
					lang: "de-DE" as LanguageCode,
					expectedPattern: /10 Minuten/,
				},
				{
					email: generateTestEmail("i18n-expiry-ta"),
					lang: "ta-IN" as LanguageCode,
					expectedPattern: /10 நிமிடங்களில்/,
				},
			];

			// Create all users first
			for (const testCase of testCases) {
				await createTestAdminUser(testCase.email, password, {
					preferredLanguage: testCase.lang,
				});
			}

			try {
				// Login all concurrently
				const loginPromises = testCases.map((tc) =>
					api.login({ email: tc.email, password: password })
				);
				const responses = await Promise.all(loginPromises);
				for (const response of responses) {
					expect(response.status).toBe(200);
				}

				// Wait for all emails concurrently
				const emailPromises = testCases.map((tc) => waitForEmail(tc.email));
				const emailSummaries = await Promise.all(emailPromises);

				// Get full email content concurrently
				const fullEmailPromises = emailSummaries.map((summary) =>
					getEmailContent(summary.ID)
				);
				const fullEmails = await Promise.all(fullEmailPromises);

				// Verify each email has the correct expiry pattern
				for (let i = 0; i < testCases.length; i++) {
					expect(fullEmails[i].Text).toMatch(testCases[i].expectedPattern);
				}
			} finally {
				// Cleanup all users
				for (const testCase of testCases) {
					await deleteTestAdminUser(testCase.email);
				}
			}
		});
	});

	// ==========================================================================
	// Parallel Execution Isolation Tests
	// ==========================================================================

	test.describe("Parallel Execution Isolation", () => {
		// These tests verify that parallel execution with different languages
		// doesn't cause race conditions or cross-contamination

		test("concurrent logins with different languages receive correct emails", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const password = TEST_PASSWORD;

			// Create users with different languages
			const users = [
				{
					email: generateTestEmail("i18n-parallel-en"),
					lang: "en-US" as LanguageCode,
				},
				{
					email: generateTestEmail("i18n-parallel-de"),
					lang: "de-DE" as LanguageCode,
				},
				{
					email: generateTestEmail("i18n-parallel-ta"),
					lang: "ta-IN" as LanguageCode,
				},
			];

			// Create all users
			for (const user of users) {
				await createTestAdminUser(user.email, password, {
					preferredLanguage: user.lang,
				});
			}

			try {
				// Login all users concurrently
				const loginPromises = users.map((user) =>
					api.login({ email: user.email, password: password })
				);
				const responses = await Promise.all(loginPromises);

				// All should succeed
				for (const response of responses) {
					expect(response.status).toBe(200);
				}

				// Wait for all emails
				const emailPromises = users.map((user) => waitForEmail(user.email));
				const emailSummaries = await Promise.all(emailPromises);

				// Get full email content
				const fullEmailPromises = emailSummaries.map((summary) =>
					getEmailContent(summary.ID)
				);
				const fullEmails = await Promise.all(fullEmailPromises);

				// Verify each email is in the correct language
				expect(fullEmails[0].Text).toContain("Your verification code is:"); // English
				expect(fullEmails[1].Text).toContain("Bestaetigungscode lautet:"); // German
				expect(fullEmails[2].Text).toContain("சரிபார்ப்புக் குறியீடு:"); // Tamil
			} finally {
				// Cleanup all users
				for (const user of users) {
					await deleteTestAdminUser(user.email);
				}
			}
		});
	});
});
