import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	createTestAdminAdminDirect,
	deleteTestAdminUser,
	generateTestEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import { AdminLoginRequest } from "vetchium-specs/admin/admin-users";

test.describe("Admin Filter Users API", () => {
	let mainAdminToken: string;
	let mainAdminEmail: string;

	// Test data users to be created/deleted
	const testUsers: string[] = [];

	test.beforeAll(async ({ request }) => {
		const adminApiClient = new AdminAPIClient(request);
		mainAdminEmail = generateTestEmail("filter-admin-main");

		await createTestAdminAdminDirect(mainAdminEmail, TEST_PASSWORD, {
			status: "active",
			fullName: "Main Admin",
		});
		testUsers.push(mainAdminEmail);

		// Login as main admin
		const loginReq: AdminLoginRequest = {
			email: mainAdminEmail,
			password: TEST_PASSWORD,
		};
		const loginRes = await adminApiClient.login(loginReq);
		expect(loginRes.status).toBe(200);

		// Verify TFA
		const tfaCode = await getTfaCodeFromEmail(mainAdminEmail);
		const tfaRes = await adminApiClient.verifyTFA({
			tfa_token: loginRes.body!.tfa_token,
			tfa_code: tfaCode,
		});
		expect(tfaRes.status).toBe(200);
		mainAdminToken = tfaRes.body!.session_token;

		// Create some additional users for filtering
		for (let i = 1; i <= 3; i++) {
			const email = generateTestEmail(`filter-target-${i}`);
			await createTestAdminUser(email, TEST_PASSWORD, {
				status: "active",
				fullName: `Filter Target ${i}`,
			});
			testUsers.push(email);
		}
		// Create one disabled user
		const disabledEmail = generateTestEmail("filter-disabled");
		await createTestAdminUser(disabledEmail, TEST_PASSWORD, {
			status: "disabled",
			fullName: "Disabled User",
		});
		testUsers.push(disabledEmail);
	});

	test.afterAll(async () => {
		for (const email of testUsers) {
			await deleteTestAdminUser(email);
		}
	});

	test("should list users with default pagination", async ({ request }) => {
		const adminApiClient = new AdminAPIClient(request);
		const response = await adminApiClient.filterUsers(mainAdminToken, {
			limit: 10,
		});
		expect(response.status).toBe(200);
		expect(response.body!.items.length).toBeGreaterThan(0);
		expect(response.body!.items.length).toBeLessThanOrEqual(10);
	});

	test("should filter users by partial email", async ({ request }) => {
		const adminApiClient = new AdminAPIClient(request);
		const response = await adminApiClient.filterUsers(mainAdminToken, {
			filter_email: "filter-target",
			limit: 10,
		});
		expect(response.status).toBe(200);
		// Should capture the 3 created users + potentially others from concurrent tests but unlikely with unique prefix
		// We check if at least our users are present or if count matches logic
		const items = response.body!.items;
		const matching = items.filter((u) =>
			u.email_address.includes("filter-target")
		);
		expect(matching.length).toBeGreaterThanOrEqual(3);
	});

	test("should filter users by partial name", async ({ request }) => {
		const adminApiClient = new AdminAPIClient(request);
		const response = await adminApiClient.filterUsers(mainAdminToken, {
			filter_name: "Filter Target",
			limit: 10,
		});
		expect(response.status).toBe(200);
		const matching = response.body!.items.filter((u) =>
			u.name.includes("Filter Target")
		);
		expect(matching.length).toBeGreaterThanOrEqual(3);
	});

	test("should filter users by status", async ({ request }) => {
		const adminApiClient = new AdminAPIClient(request);
		const response = await adminApiClient.filterUsers(mainAdminToken, {
			filter_status: "disabled",
			filter_email: "filter-disabled", // Combine to narrow down
		});
		expect(response.status).toBe(200);
		expect(response.body!.items.length).toBeGreaterThan(0);
		for (const user of response.body!.items) {
			expect(user.status).toBe("disabled");
		}
	});

	test("should support keyset pagination", async ({ request }) => {
		const adminApiClient = new AdminAPIClient(request);
		// First page
		const res1 = await adminApiClient.filterUsers(mainAdminToken, {
			limit: 2,
		});
		expect(res1.status).toBe(200);
		expect(res1.body!.items.length).toBe(2);
		const cursor = res1.body!.next_cursor;
		expect(cursor).toBeTruthy();

		// Second page
		const res2 = await adminApiClient.filterUsers(mainAdminToken, {
			limit: 2,
			cursor: cursor,
		});
		expect(res2.status).toBe(200);
		expect(res2.body!.items.length).toBeGreaterThan(0);

		// Ensure no overlap (naive check: first item of page 2 != last item of page 1)
		expect(res2.body!.items[0].email_address).not.toBe(
			res1.body!.items[1].email_address
		);
	});

	test("should return empty list for non-matching filter", async ({
		request,
	}) => {
		const adminApiClient = new AdminAPIClient(request);
		const response = await adminApiClient.filterUsers(mainAdminToken, {
			filter_email: "non-existent-random-user-xyz",
		});
		expect(response.status).toBe(200);
		expect(response.body!.items.length).toBe(0);
		expect(response.body!.next_cursor).toBe("");
	});
});
