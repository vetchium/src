import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	generateTestAgencyEmail,
	deleteTestAgencyUser,
	createTestAgencyUserDirect,
	createTestAgencyAdminDirect,
	getTestAgencyUser,
	updateTestAgencyUserStatus,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AgencyDisableUserRequest,
	AgencyEnableUserRequest,
} from "vetchium-specs/agency/agency-users";

test.describe("POST /agency/disable-user", () => {
	test("admin successfully disables another agency user", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"disable-agency-admin"
		);
		const { email: userEmail } = generateTestAgencyEmail("disable-agency-user");

		// Create admin and regular user in same agency
		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		await createTestAgencyUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			agencyId,
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
			const disableRequest: AgencyDisableUserRequest = {
				email_address: userEmail,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(200);

			// Verify user is disabled
			const user = await getTestAgencyUser(userEmail);
			expect(user).not.toBeNull();
			expect(user!.status).toBe("disabled");
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(userEmail);
		}
	});

	test("non-admin cannot disable users (403)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: userEmail, domain } =
			generateTestAgencyEmail("disable-nonadmin");
		const { email: targetEmail } = generateTestAgencyEmail("disable-target");

		// Create two non-admin users in same agency
		const { agencyId } = await createTestAgencyUserDirect(
			userEmail,
			TEST_PASSWORD
		);
		await createTestAgencyUserDirect(targetEmail, TEST_PASSWORD, "ind1", {
			agencyId,
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
			const disableRequest: AgencyDisableUserRequest = {
				email_address: targetEmail,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(403);
		} finally {
			await deleteTestAgencyUser(userEmail);
			await deleteTestAgencyUser(targetEmail);
		}
	});

	test("cannot disable last admin in agency (422)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestAgencyEmail("disable-last-admin");

		// Create only one admin
		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
			const disableRequest: AgencyDisableUserRequest = {
				email_address: adminEmail,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(422);

			// Verify admin is still active
			const admin = await getTestAgencyUser(adminEmail);
			expect(admin).not.toBeNull();
			expect(admin!.status).toBe("active");
		} finally {
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("email_address is required (400)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestAgencyEmail("disable-req-admin");

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("target user not found returns 404", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestAgencyEmail("disable-notfound");

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
			const disableRequest: AgencyDisableUserRequest = {
				email_address: "nonexistent@example.com",
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(404);
		} finally {
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("cannot disable already disabled user (422)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"disable-twice-admin"
		);
		const { email: userEmail } = generateTestAgencyEmail("disable-twice-user");

		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		await createTestAgencyUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			agencyId,
			domain,
		});

		// Manually disable the user
		await updateTestAgencyUserStatus(userEmail, "disabled");

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
			const disableRequest: AgencyDisableUserRequest = {
				email_address: userEmail,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);

			expect(disableResponse.status).toBe(422);
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(userEmail);
		}
	});

	test("without auth token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const disableResponse = await api.disableUserRaw("", {
			email_address: "some@email.com",
		});

		expect(disableResponse.status).toBe(401);
	});
});

test.describe("POST /agency/enable-user", () => {
	test("admin successfully enables a disabled agency user", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"enable-agency-admin"
		);
		const { email: userEmail } = generateTestAgencyEmail("enable-agency-user");

		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		await createTestAgencyUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			agencyId,
			domain,
		});

		// Disable the user first
		await updateTestAgencyUserStatus(userEmail, "disabled");

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
			const enableRequest: AgencyEnableUserRequest = {
				email_address: userEmail,
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(200);

			// Verify user is enabled
			const user = await getTestAgencyUser(userEmail);
			expect(user).not.toBeNull();
			expect(user!.status).toBe("active");
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(userEmail);
		}
	});

	test("non-admin cannot enable users (403)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: userEmail, domain } =
			generateTestAgencyEmail("enable-nonadmin");
		const { email: targetEmail } = generateTestAgencyEmail("enable-target");

		const { agencyId } = await createTestAgencyUserDirect(
			userEmail,
			TEST_PASSWORD
		);
		await createTestAgencyUserDirect(targetEmail, TEST_PASSWORD, "ind1", {
			agencyId,
			domain,
		});

		await updateTestAgencyUserStatus(targetEmail, "disabled");

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
			const enableRequest: AgencyEnableUserRequest = {
				email_address: targetEmail,
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(403);
		} finally {
			await deleteTestAgencyUser(userEmail);
			await deleteTestAgencyUser(targetEmail);
		}
	});

	test("cannot enable already active user (404)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } = generateTestAgencyEmail(
			"enable-active-admin"
		);
		const { email: userEmail } = generateTestAgencyEmail("enable-active-user");

		const { agencyId } = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		await createTestAgencyUserDirect(userEmail, TEST_PASSWORD, "ind1", {
			agencyId,
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
			const enableRequest: AgencyEnableUserRequest = {
				email_address: userEmail,
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(404);
		} finally {
			await deleteTestAgencyUser(adminEmail);
			await deleteTestAgencyUser(userEmail);
		}
	});

	test("email_address is required (400)", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestAgencyEmail("enable-req-admin");

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("target user not found returns 404", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestAgencyEmail("enable-notfound");

		await createTestAgencyAdminDirect(adminEmail, TEST_PASSWORD);

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
			const enableRequest: AgencyEnableUserRequest = {
				email_address: "nonexistent@example.com",
			};
			const enableResponse = await api.enableUser(sessionToken, enableRequest);

			expect(enableResponse.status).toBe(404);
		} finally {
			await deleteTestAgencyUser(adminEmail);
		}
	});

	test("without auth token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const enableResponse = await api.enableUserRaw("", {
			email_address: "some@email.com",
		});

		expect(enableResponse.status).toBe(401);
	});
});
