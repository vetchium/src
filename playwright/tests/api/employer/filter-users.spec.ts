import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	createTestOrgUserDirect,
	createTestOrgAdminDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import { OrgLoginRequest } from "vetchium-specs/employer/employer-users";

test.describe("Org Filter Users API", () => {
	let mainOrgToken: string;
	let mainOrgEmail: string;
	let mainOrgDomain: string;
	let employerId: string;

	// Test data users to be created/deleted (for cleanup)
	const testUsers: string[] = [];

	test.beforeAll(async ({ request }) => {
		const orgApiClient = new EmployerAPIClient(request);
		const { email, domain } = generateTestOrgEmail("filter-org-main");
		mainOrgEmail = email;
		mainOrgDomain = domain;

		// Create main Org Admin User (also creates Employer and Domain)
		const mainUser = await createTestOrgAdminDirect(email, TEST_PASSWORD);
		employerId = mainUser.employerId;
		testUsers.push(email);

		// Login
		const loginReq: OrgLoginRequest = {
			email: mainOrgEmail,
			domain: mainOrgDomain,
			password: TEST_PASSWORD,
		};
		const loginRes = await orgApiClient.login(loginReq);
		expect(loginRes.status).toBe(200);

		// Verify TFA
		const tfaCode = await getTfaCodeFromEmail(mainOrgEmail);
		const tfaRes = await orgApiClient.verifyTFA({
			tfa_token: loginRes.body!.tfa_token,
			tfa_code: tfaCode,
			remember_me: true,
		});
		expect(tfaRes.status).toBe(200);
		mainOrgToken = tfaRes.body!.session_token;

		// Create additional users under the SAME employer
		for (let i = 1; i <= 3; i++) {
			const userEmail = `user${i}@${mainOrgDomain}`;
			await createTestOrgUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				employerId: employerId,
				domain: mainOrgDomain,
			});
			testUsers.push(userEmail);
		}

		// Create disabled user under same employer
		const disabledEmail = `disabled@${mainOrgDomain}`;
		await createTestOrgUserDirect(disabledEmail, TEST_PASSWORD, "ind1", {
			employerId: employerId,
			domain: mainOrgDomain,
			status: "disabled",
		});
		testUsers.push(disabledEmail);
	});

	test.afterAll(async () => {
		// Cleanup
		for (const email of testUsers) {
			await deleteTestOrgUser(email);
		}
	});

	test("should list users for current employer", async ({ request }) => {
		const orgApiClient = new EmployerAPIClient(request);
		const response = await orgApiClient.filterUsers(mainOrgToken, {
			limit: 10,
		});
		expect(response.status).toBe(200);
		expect(response.body!.items.length).toBeGreaterThanOrEqual(5); // Main + 3 targets + 1 disabled
	});

	test("should filter users by partial email", async ({ request }) => {
		const orgApiClient = new EmployerAPIClient(request);
		const response = await orgApiClient.filterUsers(mainOrgToken, {
			filter_email: "user", // Matches user1, user2, user3
			limit: 10,
		});
		expect(response.status).toBe(200);
		// Expect at least 3 users
		const matching = response.body!.items.filter((u) =>
			u.email_address.includes("user")
		);
		expect(matching.length).toBeGreaterThanOrEqual(3);
	});

	test("should filter users by status", async ({ request }) => {
		const orgApiClient = new EmployerAPIClient(request);
		const response = await orgApiClient.filterUsers(mainOrgToken, {
			filter_status: "disabled",
		});
		expect(response.status).toBe(200);
		const matching = response.body!.items.filter(
			(u) => u.status === "disabled"
		);
		expect(matching.length).toBe(1);
		expect(matching[0].email_address).toContain("disabled");
	});

	test("should support keyset pagination", async ({ request }) => {
		const orgApiClient = new EmployerAPIClient(request);
		const res1 = await orgApiClient.filterUsers(mainOrgToken, {
			limit: 2,
		});
		expect(res1.body!.items.length).toBe(2);
		const cursor = res1.body!.next_cursor;
		expect(cursor).toBeTruthy();

		const res2 = await orgApiClient.filterUsers(mainOrgToken, {
			limit: 2,
			cursor: cursor,
		});
		expect(res2.body!.items.length).toBeGreaterThan(0);
		expect(res2.body!.items[0].email_address).not.toBe(
			res1.body!.items[1].email_address
		);
	});

	test("user without user management roles gets 403", async ({ request }) => {
		const orgApiClient = new EmployerAPIClient(request);
		const { email: noRoleEmail, domain: noRoleDomain } =
			generateTestOrgEmail("filter-org-norole");

		// Create a user with no roles (not an admin)
		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			employerId: employerId,
			domain: mainOrgDomain,
		});
		testUsers.push(noRoleEmail);

		// Login as the role-less user
		const loginRes = await orgApiClient.login({
			email: noRoleEmail,
			domain: mainOrgDomain,
			password: TEST_PASSWORD,
		});
		expect(loginRes.status).toBe(200);

		const tfaCode = await getTfaCodeFromEmail(noRoleEmail);
		const tfaRes = await orgApiClient.verifyTFA({
			tfa_token: loginRes.body!.tfa_token,
			tfa_code: tfaCode,
			remember_me: false,
		});
		expect(tfaRes.status).toBe(200);
		const noRoleToken = tfaRes.body!.session_token;

		const response = await orgApiClient.filterUsers(noRoleToken, {
			limit: 10,
		});
		expect(response.status).toBe(403);

		// noRoleEmail is already added to testUsers for cleanup in afterAll
		void noRoleDomain;
	});
});
