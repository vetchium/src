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
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
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
		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			employerId,
			domain,
		});

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Disable the user
			const disableRequest: OrgDisableUserRequest = {
				email_address: userEmail,
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
		const { email: userEmail, domain } =
			generateTestOrgEmail("disable-nonadmin");
		const { email: targetEmail } = generateTestOrgEmail("disable-target");

		// Create two non-admin users in same employer
		const { employerId } = await createTestOrgUserDirect(
			userEmail,
			TEST_PASSWORD
		);
		await createTestOrgUserDirect(targetEmail, TEST_PASSWORD, "ind1", {
			employerId,
			domain,
		});

		try {
			// Login as non-admin
			const loginResponse = await api.login({
				email: userEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(userEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable another user
			const disableRequest: OrgDisableUserRequest = {
				email_address: targetEmail,
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
		const { email: adminEmail, domain } =
			generateTestOrgEmail("disable-last-admin");

		// Create only one admin
		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable self (last admin)
			const disableRequest: OrgDisableUserRequest = {
				email_address: adminEmail,
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

	test("email_address is required (400)", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("disable-req-admin");

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try without email_address
			const disableResponse = await api.disableUserRaw(sessionToken, {});

			expect(disableResponse.status).toBe(400);
			expect(disableResponse.errors).toBeDefined();
		} finally {
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("target user not found returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("disable-notfound");

		await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);

		try {
			// Login
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try with non-existent email
			const disableRequest: OrgDisableUserRequest = {
				email_address: "nonexistent@example.com",
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
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"disable-twice-admin"
		);
		const { email: userEmail } = generateTestOrgEmail("disable-twice-user");

		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			employerId,
			domain,
		});

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

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable already disabled user
			const disableRequest: OrgDisableUserRequest = {
				email_address: userEmail,
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
			email_address: "some@email.com",
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

		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			employerId,
			domain,
		});

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

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Enable the user
			const enableRequest: OrgEnableUserRequest = {
				email_address: userEmail,
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

		const { employerId } = await createTestOrgUserDirect(
			userEmail,
			TEST_PASSWORD
		);
		await createTestOrgUserDirect(targetEmail, TEST_PASSWORD, "ind1", {
			employerId,
			domain,
		});

		await updateTestOrgUserStatus(targetEmail, "disabled");

		try {
			// Login as non-admin
			const loginResponse = await api.login({
				email: userEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(userEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to enable another user
			const enableRequest: OrgEnableUserRequest = {
				email_address: targetEmail,
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
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"enable-active-admin"
		);
		const { email: userEmail } = generateTestOrgEmail("enable-active-user");

		const { employerId } = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			employerId,
			domain,
		});

		try {
			// Login as admin
			const loginResponse = await api.login({
				email: adminEmail,
				domain,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to enable already active user
			const enableRequest: OrgEnableUserRequest = {
				email_address: userEmail,
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(404);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(userEmail);
		}
	});

	test("email_address is required (400)", async ({ request }) => {
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

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try without email_address
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

			const tfaCode = await getTfaCodeFromEmail(adminEmail);

			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try with non-existent email
			const enableRequest: OrgEnableUserRequest = {
				email_address: "nonexistent@example.com",
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
			email_address: "some@email.com",
		});

		expect(enableResponse.status).toBe(401);
	});
});
