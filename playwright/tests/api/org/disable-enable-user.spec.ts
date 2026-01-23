import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	createTestOrgUserDirect,
	createTestOrgAdminDirect,
	getTestOrgUser,
	updateTestOrgUserStatus,
} from "../../../lib/db";
import { waitForEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgDisableUserRequest,
	OrgEnableUserRequest,
} from "vetchium-specs/org/org-users";

test.describe("POST /employer/disable-user", () => {
	test("admin successfully disables another org user", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("disable-org-admin");
		const { email: userEmail } = generateTestOrgEmail("disable-org-user");

		// Create admin and regular user in same employer
		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: userId } = await createTestOrgUserDirect(
			userEmail,
			TEST_PASSWORD
		);

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Disable the user
			const disableRequest: OrgDisableUserRequest = {
				target_user_id: userId,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(200);

			// Verify user is disabled
			const user = await getTestOrgUser(userEmail);
			expect(user).not.toBeNull();
			expect(user!.status).toBe("disabled");
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
		}
	});

	test("non-admin cannot disable users (403)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: userEmail, domain } = generateTestOrgEmail(
			"disable-nonadmin"
		);
		const { email: targetEmail } = generateTestOrgEmail("disable-target");

		// Create two non-admin users
		await createTestOrgUserDirect(userEmail, TEST_PASSWORD);
		const { orgUserId: targetId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		try {
			// Login as non-admin
			const loginResponse = await api.login({
				email: userEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(userEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable another user
			const disableRequest: OrgDisableUserRequest = {
				target_user_id: targetId,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(403);
		} finally {
			await deleteTestOrgUser(userEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("cannot disable last admin in employer (422)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"disable-last-admin"
		);

		// Create only one admin
		const { orgUserId: adminId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable self (last admin)
			const disableRequest: OrgDisableUserRequest = {
				target_user_id: adminId,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(422);

			// Verify admin is still active
			const admin = await getTestOrgUser(adminEmail);
			expect(admin).not.toBeNull();
			expect(admin!.status).toBe("active");
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("target_user_id is required (400)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"disable-req-admin"
		);

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try without target_user_id
			const disableResponse = await api.disableUserRaw(sessionToken, {});

			expect(disableResponse.status).toBe(400);
			expect(disableResponse.errors).toBeDefined();
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("invalid target_user_id format returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"disable-invalid"
		);

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try with invalid UUID
			const disableResponse = await api.disableUserRaw(sessionToken, {
				target_user_id: "not-a-uuid",
			});

			expect(disableResponse.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("target user not found returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"disable-notfound"
		);

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try with non-existent user ID
			const disableRequest: OrgDisableUserRequest = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(404);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("cannot disable already disabled user (422)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("disable-twice-admin");
		const { email: userEmail } = generateTestOrgEmail("disable-twice-user");

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: userId } = await createTestOrgUserDirect(
			userEmail,
			TEST_PASSWORD
		);

		// Manually disable the user
		await updateTestOrgUserStatus(userEmail, "disabled");

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable already disabled user
			const disableRequest: OrgDisableUserRequest = {
				target_user_id: userId,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
		}
	});

	test("without auth token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const disableResponse = await api.disableUserRaw("", {
			target_user_id: "00000000-0000-0000-0000-000000000000",
		});

		expect(disableResponse.status).toBe(401);
	});
});

test.describe("POST /employer/enable-user", () => {
	test("admin successfully enables a disabled org user", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("enable-org-admin");
		const { email: userEmail } = generateTestOrgEmail("enable-org-user");

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: userId } = await createTestOrgUserDirect(
			userEmail,
			TEST_PASSWORD
		);

		// Disable the user first
		await updateTestOrgUserStatus(userEmail, "disabled");

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Enable the user
			const enableRequest: OrgEnableUserRequest = {
				target_user_id: userId,
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(200);

			// Verify user is enabled
			const user = await getTestOrgUser(userEmail);
			expect(user).not.toBeNull();
			expect(user!.status).toBe("active");
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
		}
	});

	test("non-admin cannot enable users (403)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: userEmail, domain } =
			generateTestOrgEmail("enable-nonadmin");
		const { email: targetEmail } = generateTestOrgEmail("enable-target");

		await createTestOrgUserDirect(userEmail, TEST_PASSWORD);
		const { orgUserId: targetId } = await createTestOrgUserDirect(
			targetEmail,
			TEST_PASSWORD
		);

		await updateTestOrgUserStatus(targetEmail, "disabled");

		try {
			// Login as non-admin
			const loginResponse = await api.login({
				email: userEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(userEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to enable another user
			const enableRequest: OrgEnableUserRequest = {
				target_user_id: targetId,
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(403);
		} finally {
			await deleteTestOrgUser(userEmail);
			await deleteTestOrgUser(targetEmail);
		}
	});

	test("cannot enable already active user (404)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("enable-active-admin");
		const { email: userEmail } = generateTestOrgEmail("enable-active-user");

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgUserId: userId } = await createTestOrgUserDirect(
			userEmail,
			TEST_PASSWORD
		);

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to enable already active user
			const enableRequest: OrgEnableUserRequest = {
				target_user_id: userId,
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(404);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
		}
	});

	test("target_user_id is required (400)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("enable-req-admin");

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try without target_user_id
			const enableResponse = await api.enableUserRaw(sessionToken, {});

			expect(enableResponse.status).toBe(400);
			expect(enableResponse.errors).toBeDefined();
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("target user not found returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("enable-notfound");

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaEmail = await waitForEmail(adminEmail);
			const tfaCode = tfaEmail.Text.match(/\b\d{6}\b/)?.[0];
			expect(tfaCode).toBeDefined();

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode!,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try with non-existent user ID
			const enableRequest: OrgEnableUserRequest = {
				target_user_id: "00000000-0000-0000-0000-000000000000",
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(404);
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("without auth token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const enableResponse = await api.enableUserRaw("", {
			target_user_id: "00000000-0000-0000-0000-000000000000",
		});

		expect(enableResponse.status).toBe(401);
	});
});
