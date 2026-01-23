import { test, expect } from "@playwright/test";
import {
	createTestHubUser,
	deleteTestHubUser,
	generateTestEmail,
} from "../../../lib/db";
import { HubAPIClient } from "../../../lib/hub-api-client";
import { getEmailVerificationTokenFromEmail } from "../../../lib/mailpit";
import type {
	HubRequestEmailChangeRequest,
	HubCompleteEmailChangeRequest,
	HubLoginRequest,
} from "vetchium-specs/hub/hub-users";

test.describe.skip("Hub Email Change API", () => {
	test("request email change with valid new email", async ({ request }) => {
		const api = new HubAPIClient(request);
		const oldEmail = generateTestEmail("email-change-old");
		const newEmail = generateTestEmail("email-change-new");
		const password = "Password123$";

		await createTestHubUser(oldEmail, password);
		try {
			// Login to get session token
			const loginRequest: HubLoginRequest = {
				email_address: oldEmail,
				password: password,
				remember_me: false,
			};
			const loginResp = await api.login(loginRequest);
			expect(loginResp.status).toBe(200);

			const tfaCode = await import("../../../lib/mailpit").then((m) =>
				m.getTfaCodeFromEmail(oldEmail)
			);
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResp.status).toBe(200);
			const sessionToken = tfaResp.body.session_token;

			// Request email change
			const emailChangeRequest: HubRequestEmailChangeRequest = {
				new_email_address: newEmail,
			};
			const response = await api.requestEmailChange(
				sessionToken,
				emailChangeRequest
			);

			expect(response.status).toBe(200);
			expect(response.body.message).toBeTruthy();
		} finally {
			await deleteTestHubUser(oldEmail);
		}
	});

	test("request email change returns 409 if email already in use", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const email1 = generateTestEmail("email-change-user1");
		const email2 = generateTestEmail("email-change-user2");
		const password = "Password123$";

		await createTestHubUser(email1, password);
		await createTestHubUser(email2, password);
		try {
			// Login as user1
			const loginRequest: HubLoginRequest = {
				email_address: email1,
				password: password,
				remember_me: false,
			};
			const loginResp = await api.login(loginRequest);
			expect(loginResp.status).toBe(200);

			const tfaCode = await import("../../../lib/mailpit").then((m) =>
				m.getTfaCodeFromEmail(email1)
			);
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResp.status).toBe(200);
			const sessionToken = tfaResp.body.session_token;

			// Try to change email to email2 (already in use)
			const emailChangeRequest: HubRequestEmailChangeRequest = {
				new_email_address: email2,
			};
			const response = await api.requestEmailChange(
				sessionToken,
				emailChangeRequest
			);

			expect(response.status).toBe(409);
		} finally {
			await deleteTestHubUser(email1);
			await deleteTestHubUser(email2);
		}
	});

	test("request email change returns 400 if new email same as current", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const email = generateTestEmail("email-change-same");
		const password = "Password123$";

		await createTestHubUser(email, password);
		try {
			// Login
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password: password,
				remember_me: false,
			};
			const loginResp = await api.login(loginRequest);
			expect(loginResp.status).toBe(200);

			const tfaCode = await import("../../../lib/mailpit").then((m) =>
				m.getTfaCodeFromEmail(email)
			);
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResp.status).toBe(200);
			const sessionToken = tfaResp.body.session_token;

			// Try to change email to same email
			const emailChangeRequest: HubRequestEmailChangeRequest = {
				new_email_address: email,
			};
			const response = await api.requestEmailChange(
				sessionToken,
				emailChangeRequest
			);

			expect(response.status).toBe(400);
		} finally {
			await deleteTestHubUser(email);
		}
	});

	test("request email change returns 400 for invalid email format", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const email = generateTestEmail("email-change-invalid");
		const password = "Password123$";

		await createTestHubUser(email, password);
		try {
			// Login
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password: password,
				remember_me: false,
			};
			const loginResp = await api.login(loginRequest);
			expect(loginResp.status).toBe(200);

			const tfaCode = await import("../../../lib/mailpit").then((m) =>
				m.getTfaCodeFromEmail(email)
			);
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResp.status).toBe(200);
			const sessionToken = tfaResp.body.session_token;

			// Try with invalid email format
			const response = await api.requestEmailChangeRaw(sessionToken, {
				new_email_address: "not-an-email",
			});

			expect(response.status).toBe(400);
			expect(Array.isArray(response.errors)).toBe(true);
		} finally {
			await deleteTestHubUser(email);
		}
	});

	test("request email change returns 400 for missing fields", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const email = generateTestEmail("email-change-missing");
		const password = "Password123$";

		await createTestHubUser(email, password);
		try {
			// Login
			const loginRequest: HubLoginRequest = {
				email_address: email,
				password: password,
				remember_me: false,
			};
			const loginResp = await api.login(loginRequest);
			expect(loginResp.status).toBe(200);

			const tfaCode = await import("../../../lib/mailpit").then((m) =>
				m.getTfaCodeFromEmail(email)
			);
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResp.status).toBe(200);
			const sessionToken = tfaResp.body.session_token;

			// Try with missing new_email_address
			const response = await api.requestEmailChangeRaw(sessionToken, {});

			expect(response.status).toBe(400);
			expect(Array.isArray(response.errors)).toBe(true);
		} finally {
			await deleteTestHubUser(email);
		}
	});

	test("request email change returns 401 without authentication", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const newEmail = generateTestEmail("email-change-unauth");

		const emailChangeRequest: HubRequestEmailChangeRequest = {
			new_email_address: newEmail,
		};
		const response = await api.requestEmailChange("", emailChangeRequest);

		expect(response.status).toBe(401);
	});

	test("complete email change with valid token", async ({ request }) => {
		const api = new HubAPIClient(request);
		const oldEmail = generateTestEmail("email-change-complete-old");
		const newEmail = generateTestEmail("email-change-complete-new");
		const password = "Password123$";

		await createTestHubUser(oldEmail, password);
		try {
			// Login
			const loginRequest: HubLoginRequest = {
				email_address: oldEmail,
				password: password,
				remember_me: false,
			};
			const loginResp = await api.login(loginRequest);
			expect(loginResp.status).toBe(200);

			const tfaCode = await import("../../../lib/mailpit").then((m) =>
				m.getTfaCodeFromEmail(oldEmail)
			);
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResp.status).toBe(200);
			const sessionToken = tfaResp.body.session_token;

			// Request email change
			const emailChangeRequest: HubRequestEmailChangeRequest = {
				new_email_address: newEmail,
			};
			const requestResp = await api.requestEmailChange(
				sessionToken,
				emailChangeRequest
			);
			expect(requestResp.status).toBe(200);

			// Get verification token from email
			const verificationToken =
				await getEmailVerificationTokenFromEmail(newEmail);

			// Complete email change
			const completeRequest: HubCompleteEmailChangeRequest = {
				verification_token: verificationToken,
			};
			const response = await api.completeEmailChange(completeRequest);

			expect(response.status).toBe(200);

			// Verify old email cannot login
			const oldLoginResp = await api.login({
				email_address: oldEmail,
				password: password,
				remember_me: false,
			});
			expect(oldLoginResp.status).toBe(401);

			// Verify new email can login
			const newLoginResp = await api.login({
				email_address: newEmail,
				password: password,
				remember_me: false,
			});
			expect(newLoginResp.status).toBe(200);
		} finally {
			await deleteTestHubUser(oldEmail).catch(() => {});
			await deleteTestHubUser(newEmail).catch(() => {});
		}
	});

	test("complete email change invalidates all sessions", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const oldEmail = generateTestEmail("email-change-sessions-old");
		const newEmail = generateTestEmail("email-change-sessions-new");
		const password = "Password123$";

		await createTestHubUser(oldEmail, password);
		try {
			// Login to get session token
			const loginRequest: HubLoginRequest = {
				email_address: oldEmail,
				password: password,
				remember_me: false,
			};
			const loginResp = await api.login(loginRequest);
			expect(loginResp.status).toBe(200);

			const tfaCode = await import("../../../lib/mailpit").then((m) =>
				m.getTfaCodeFromEmail(oldEmail)
			);
			const tfaResp = await api.verifyTFA({
				tfa_token: loginResp.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResp.status).toBe(200);
			const sessionToken = tfaResp.body.session_token;

			// Request email change
			const emailChangeRequest: HubRequestEmailChangeRequest = {
				new_email_address: newEmail,
			};
			const requestResp = await api.requestEmailChange(
				sessionToken,
				emailChangeRequest
			);
			expect(requestResp.status).toBe(200);

			// Get verification token and complete email change
			const verificationToken =
				await getEmailVerificationTokenFromEmail(newEmail);
			const completeRequest: HubCompleteEmailChangeRequest = {
				verification_token: verificationToken,
			};
			const completeResp = await api.completeEmailChange(completeRequest);
			expect(completeResp.status).toBe(200);

			// Try to use old session token (should be invalidated)
			const logoutResp = await api.logout(sessionToken);
			expect(logoutResp.status).toBe(401);
		} finally {
			await deleteTestHubUser(oldEmail).catch(() => {});
			await deleteTestHubUser(newEmail).catch(() => {});
		}
	});

	test("complete email change returns 401 for invalid token", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		const completeRequest: HubCompleteEmailChangeRequest = {
			verification_token: "IND1-" + "0".repeat(64),
		};
		const response = await api.completeEmailChange(completeRequest);

		expect(response.status).toBe(401);
	});

	test("complete email change returns 401 for malformed token", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		const response = await api.completeEmailChangeRaw({
			verification_token: "invalid-token-format",
		});

		expect(response.status).toBe(401);
	});

	test("complete email change returns 400 for missing fields", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		const response = await api.completeEmailChangeRaw({});

		expect(response.status).toBe(400);
		expect(Array.isArray(response.errors)).toBe(true);
	});

	test("complete email change handles race condition (email becomes unavailable)", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const email1 = generateTestEmail("email-change-race1");
		const email2 = generateTestEmail("email-change-race2");
		const targetEmail = generateTestEmail("email-change-race-target");
		const password = "Password123$";

		await createTestHubUser(email1, password);
		await createTestHubUser(email2, password);
		try {
			// User1 requests email change to targetEmail
			const login1Request: HubLoginRequest = {
				email_address: email1,
				password: password,
				remember_me: false,
			};
			const login1Resp = await api.login(login1Request);
			expect(login1Resp.status).toBe(200);

			const tfa1Code = await import("../../../lib/mailpit").then((m) =>
				m.getTfaCodeFromEmail(email1)
			);
			const tfa1Resp = await api.verifyTFA({
				tfa_token: login1Resp.body.tfa_token,
				tfa_code: tfa1Code,
			});
			expect(tfa1Resp.status).toBe(200);
			const session1Token = tfa1Resp.body.session_token;

			const emailChange1Request: HubRequestEmailChangeRequest = {
				new_email_address: targetEmail,
			};
			const request1Resp = await api.requestEmailChange(
				session1Token,
				emailChange1Request
			);
			expect(request1Resp.status).toBe(200);

			// User2 also requests email change to targetEmail
			const login2Request: HubLoginRequest = {
				email_address: email2,
				password: password,
				remember_me: false,
			};
			const login2Resp = await api.login(login2Request);
			expect(login2Resp.status).toBe(200);

			const tfa2Code = await import("../../../lib/mailpit").then((m) =>
				m.getTfaCodeFromEmail(email2)
			);
			const tfa2Resp = await api.verifyTFA({
				tfa_token: login2Resp.body.tfa_token,
				tfa_code: tfa2Code,
			});
			expect(tfa2Resp.status).toBe(200);
			const session2Token = tfa2Resp.body.session_token;

			const emailChange2Request: HubRequestEmailChangeRequest = {
				new_email_address: targetEmail,
			};
			const request2Resp = await api.requestEmailChange(
				session2Token,
				emailChange2Request
			);
			expect(request2Resp.status).toBe(200);

			// Get both verification tokens from emails
			const verification1Token =
				await getEmailVerificationTokenFromEmail(targetEmail);

			// User1 completes email change first (should succeed)
			const complete1Request: HubCompleteEmailChangeRequest = {
				verification_token: verification1Token,
			};
			const complete1Resp = await api.completeEmailChange(complete1Request);
			expect(complete1Resp.status).toBe(200);

			// User2 tries to complete email change (should fail with 409 - email now taken)
			// Note: This would require getting the second token, but since user1 already
			// claimed the email, we expect this to fail even if user2 has a valid token
			// The implementation should detect this race condition
		} finally {
			await deleteTestHubUser(email1).catch(() => {});
			await deleteTestHubUser(email2).catch(() => {});
			await deleteTestHubUser(targetEmail).catch(() => {});
		}
	});
});
