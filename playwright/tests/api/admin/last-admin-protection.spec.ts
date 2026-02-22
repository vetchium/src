/**
 * Last Admin Protection Tests
 *
 * These tests verify that the system prevents disabling the last active admin.
 * Each test creates its own unique admin users with UUID-based emails.
 * Tests run serially to avoid interference when temporarily disabling other admins.
 *
 * IMPORTANT: These tests temporarily disable ALL other admins to test the
 * "last admin protection" scenario. They are configured to run in the
 * "api-isolated" project (see playwright.config.ts) which runs after other
 * API tests complete. When using --repeat-each, run with --workers=1 to
 * ensure proper isolation.
 */
import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	getTestAdminUser,
	getAllActiveAdminIds,
	updateAdminUserStatusByIds,
	countActiveAdminUsers,
	assignRoleToAdminUser,
	getAllActiveAdminIdsWithRole,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AdminDisableUserRequest,
	RemoveRoleRequest,
} from "vetchium-specs/admin/admin-users";

// Run this file serially to avoid interference when manipulating admin counts
test.describe.configure({ mode: "serial" });

test.describe("Last Admin Protection", () => {
	test("can disable one of two admins (200)", async ({ request }) => {
		// Create unique admins for this test
		const admin1Email = generateTestEmail("lastadmin-test1-admin1");
		const admin2Email = generateTestEmail("lastadmin-test1-admin2");
		let admin1Id: string;
		let admin2Id: string;
		let disabledAdminIds: string[] = [];

		try {
			// Setup: create two test admins
			admin1Id = await createTestAdminUser(admin1Email, TEST_PASSWORD);
			admin2Id = await createTestAdminUser(admin2Email, TEST_PASSWORD);

			// Assign admin:manage_users role to admin1 (required for disable operations)
			await assignRoleToAdminUser(admin1Id, "admin:manage_users");

			// Disable all other admins to isolate this test
			const allActiveAdmins = await getAllActiveAdminIds();
			const otherAdmins = allActiveAdmins.filter(
				(id) => id !== admin1Id && id !== admin2Id
			);
			if (otherAdmins.length > 0) {
				await updateAdminUserStatusByIds(otherAdmins, "disabled");
				disabledAdminIds = otherAdmins;
			}

			// Verify exactly 2 active admins
			const count = await countActiveAdminUsers();
			expect(count).toBe(2);

			// Login as admin1
			const api = new AdminAPIClient(request);
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(admin1Email);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Disable admin2 - should succeed because we have 2 active admins
			const disableRequest: AdminDisableUserRequest = {
				email_address: admin2Email,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);
			expect(disableResponse.status).toBe(200);

			// Verify admin2 is now disabled
			const admin2 = await getTestAdminUser(admin2Email);
			expect(admin2).not.toBeNull();
			expect(admin2!.status).toBe("disabled");

			// Verify only 1 active admin remains
			const countAfter = await countActiveAdminUsers();
			expect(countAfter).toBe(1);
		} finally {
			// Restore disabled admins
			if (disabledAdminIds.length > 0) {
				await updateAdminUserStatusByIds(disabledAdminIds, "active");
			}
			// Cleanup test admins
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
	});

	test("cannot disable the last admin (422)", async ({ request }) => {
		// Create unique admins for this test
		const admin1Email = generateTestEmail("lastadmin-test2-admin1");
		const admin2Email = generateTestEmail("lastadmin-test2-admin2");
		let admin1Id: string;
		let admin2Id: string;
		let disabledAdminIds: string[] = [];

		try {
			// Setup: create two test admins, then disable one to have exactly 1 active
			admin1Id = await createTestAdminUser(admin1Email, TEST_PASSWORD);
			admin2Id = await createTestAdminUser(admin2Email, TEST_PASSWORD);

			// Assign admin:manage_users role to admin1 (required for disable operations)
			await assignRoleToAdminUser(admin1Id, "admin:manage_users");

			// Disable admin2 directly in DB
			await updateAdminUserStatusByIds([admin2Id], "disabled");

			// Disable all other admins to isolate this test
			const allActiveAdmins = await getAllActiveAdminIds();
			const otherAdmins = allActiveAdmins.filter((id) => id !== admin1Id);
			if (otherAdmins.length > 0) {
				await updateAdminUserStatusByIds(otherAdmins, "disabled");
				disabledAdminIds = otherAdmins.filter((id) => id !== admin2Id);
			}

			// Verify exactly 1 active admin
			const count = await countActiveAdminUsers();
			expect(count).toBe(1);

			// Login as admin1
			const api = new AdminAPIClient(request);
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(admin1Email);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to disable admin1 (the last admin) - should fail with 422
			const disableRequest: AdminDisableUserRequest = {
				email_address: admin1Email,
			};
			const disableResponse = await api.disableUser(
				sessionToken,
				disableRequest
			);
			expect(disableResponse.status).toBe(422);

			// Verify admin1 is still active
			const admin1 = await getTestAdminUser(admin1Email);
			expect(admin1).not.toBeNull();
			expect(admin1!.status).toBe("active");

			// Verify still only 1 active admin
			const countAfter = await countActiveAdminUsers();
			expect(countAfter).toBe(1);
		} finally {
			// Restore disabled admins
			if (disabledAdminIds.length > 0) {
				await updateAdminUserStatusByIds(disabledAdminIds, "active");
			}
			// Cleanup test admins
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
	});

	test("can enable disabled admin and then disable is allowed again", async ({
		request,
	}) => {
		// Create unique admins for this test
		const admin1Email = generateTestEmail("lastadmin-test3-admin1");
		const admin2Email = generateTestEmail("lastadmin-test3-admin2");
		let admin1Id: string;
		let admin2Id: string;
		let disabledAdminIds: string[] = [];

		try {
			// Setup: create two test admins, disable admin2
			admin1Id = await createTestAdminUser(admin1Email, TEST_PASSWORD);
			admin2Id = await createTestAdminUser(admin2Email, TEST_PASSWORD);

			// Assign admin:manage_users role to both admins (needed for enable/disable operations)
			await assignRoleToAdminUser(admin1Id, "admin:manage_users");
			await assignRoleToAdminUser(admin2Id, "admin:manage_users");

			// Disable admin2 directly in DB (simulating previous disable)
			await updateAdminUserStatusByIds([admin2Id], "disabled");

			// Disable all other admins to isolate this test
			const allActiveAdmins = await getAllActiveAdminIds();
			const otherAdmins = allActiveAdmins.filter((id) => id !== admin1Id);
			if (otherAdmins.length > 0) {
				await updateAdminUserStatusByIds(otherAdmins, "disabled");
				disabledAdminIds = otherAdmins.filter((id) => id !== admin2Id);
			}

			// Verify exactly 1 active admin
			const countBefore = await countActiveAdminUsers();
			expect(countBefore).toBe(1);

			// Login as admin1
			const api = new AdminAPIClient(request);
			const loginResponse = await api.login({
				email: admin1Email,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(admin1Email);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Enable admin2
			const enableResponse = await api.enableUser(sessionToken, {
				email_address: admin2Email,
			});
			expect(enableResponse.status).toBe(200);

			// Verify now we have 2 active admins
			const countAfterEnable = await countActiveAdminUsers();
			expect(countAfterEnable).toBe(2);

			// Now admin1 can disable themselves (since admin2 is active)
			const disableSelfRequest: AdminDisableUserRequest = {
				email_address: admin1Email,
			};
			const disableSelfResponse = await api.disableUser(
				sessionToken,
				disableSelfRequest
			);
			expect(disableSelfResponse.status).toBe(200);

			// Verify admin1 is now disabled
			const admin1 = await getTestAdminUser(admin1Email);
			expect(admin1).not.toBeNull();
			expect(admin1!.status).toBe("disabled");

			// Re-enable admin1 for cleanup (login as admin2)
			const login2Response = await api.login({
				email: admin2Email,
				password: TEST_PASSWORD,
			});
			expect(login2Response.status).toBe(200);

			const tfa2Code = await getTfaCodeFromEmail(admin2Email);
			const tfa2Response = await api.verifyTFA({
				tfa_token: login2Response.body.tfa_token,
				tfa_code: tfa2Code,
			});
			expect(tfa2Response.status).toBe(200);
			const sessionToken2 = tfa2Response.body.session_token;

			const enableAdmin1Response = await api.enableUser(sessionToken2, {
				email_address: admin1Email,
			});
			expect(enableAdmin1Response.status).toBe(200);

			// Verify both admins are active again
			const finalCount = await countActiveAdminUsers();
			expect(finalCount).toBe(2);
		} finally {
			// Restore disabled admins
			if (disabledAdminIds.length > 0) {
				await updateAdminUserStatusByIds(disabledAdminIds, "active");
			}
			// Cleanup test admins
			await deleteTestAdminUser(admin1Email);
			await deleteTestAdminUser(admin2Email);
		}
	});

	test("cannot remove superadmin role from the last active superadmin (422)", async ({
		request,
	}) => {
		const adminEmail = generateTestEmail("last-sa-role-admin");
		let adminId = "";
		let disabledSuperadminIds: string[] = [];

		try {
			// Create a test admin with superadmin and manage_users roles
			adminId = await createTestAdminUser(adminEmail, TEST_PASSWORD);
			await assignRoleToAdminUser(adminId, "admin:superadmin");
			await assignRoleToAdminUser(adminId, "admin:manage_users");

			// Disable all other active admins with admin:superadmin to isolate the test
			const otherSuperadmins = await getAllActiveAdminIdsWithRole(
				"admin:superadmin",
				adminId
			);
			if (otherSuperadmins.length > 0) {
				await updateAdminUserStatusByIds(otherSuperadmins, "disabled");
				disabledSuperadminIds = otherSuperadmins;
			}

			// Login as our test admin
			const api = new AdminAPIClient(request);
			const loginResponse = await api.login({
				email: adminEmail,
				password: TEST_PASSWORD,
			});
			expect(loginResponse.status).toBe(200);

			const tfaCode = await getTfaCodeFromEmail(adminEmail);
			const tfaResponse = await api.verifyTFA({
				tfa_token: loginResponse.body.tfa_token,
				tfa_code: tfaCode,
			});
			expect(tfaResponse.status).toBe(200);
			const sessionToken = tfaResponse.body.session_token;

			// Try to remove superadmin role from self (last active superadmin)
			const removeRequest: RemoveRoleRequest = {
				target_user_id: adminId,
				role_name: "admin:superadmin",
			};
			const removeResponse = await api.removeRole(sessionToken, removeRequest);

			expect(removeResponse.status).toBe(422);
		} finally {
			// Restore disabled superadmins
			if (disabledSuperadminIds.length > 0) {
				await updateAdminUserStatusByIds(disabledSuperadminIds, "active");
			}
			await deleteTestAdminUser(adminEmail);
		}
	});
});
