import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	createTestAgencyUserDirect,
	deleteTestAgencyUser,
	generateTestAgencyEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import { AgencyLoginRequest } from "vetchium-specs/agency/agency-users";

test.describe("Agency Filter Users API", () => {
	let mainAgencyToken: string;
	let mainAgencyEmail: string;
	let mainAgencyDomain: string;
	let agencyId: string;

	// Test data users to be created/deleted
	const testUsers: string[] = [];

	test.beforeAll(async ({ request }) => {
		const agencyApiClient = new AgencyAPIClient(request);
		const { email, domain } = generateTestAgencyEmail("filter-agency-main");
		mainAgencyEmail = email;
		mainAgencyDomain = domain;

		// Create main Agency User (creates Agency and Verified Domain)
		const mainUser = await createTestAgencyUserDirect(
			email,
			TEST_PASSWORD,
			"ind1"
		);
		// Note: createTestAgencyUserDirect returns { email, domain, agencyId, agencyUserId }
		agencyId = mainUser.agencyId;
		testUsers.push(email);

		// Login
		const loginReq: AgencyLoginRequest = {
			email: mainAgencyEmail,
			domain: mainAgencyDomain,
			password: TEST_PASSWORD,
		};
		const loginRes = await agencyApiClient.login(loginReq);
		expect(loginRes.status).toBe(200);

		// Verify TFA
		const tfaCode = await getTfaCodeFromEmail(mainAgencyEmail);
		const tfaRes = await agencyApiClient.verifyTFA({
			tfa_token: loginRes.body!.tfa_token,
			tfa_code: tfaCode,
			remember_me: true,
		});
		expect(tfaRes.status).toBe(200);
		mainAgencyToken = tfaRes.body!.session_token;

		// Create additional users under same agency
		for (let i = 1; i <= 3; i++) {
			const userEmail = `user${i}@${mainAgencyDomain}`;
			await createTestAgencyUserDirect(userEmail, TEST_PASSWORD, "ind1", {
				agencyId: agencyId,
				domain: mainAgencyDomain,
			});
			testUsers.push(userEmail);
		}

		// Create disabled user
		const disabledEmail = `disabled@${mainAgencyDomain}`;
		await createTestAgencyUserDirect(disabledEmail, TEST_PASSWORD, "ind1", {
			agencyId: agencyId,
			domain: mainAgencyDomain,
			status: "disabled",
		});
		testUsers.push(disabledEmail);
	});

	test.afterAll(async () => {
		for (const email of testUsers) {
			await deleteTestAgencyUser(email);
		}
	});

	test("should list users for current agency", async ({ request }) => {
		const agencyApiClient = new AgencyAPIClient(request);
		const response = await agencyApiClient.filterUsers(mainAgencyToken, {
			limit: 10,
		});
		expect(response.status).toBe(200);
		// Expect at least Main + 3 targets + 1 disabled = 5
		expect(response.body!.items.length).toBeGreaterThanOrEqual(5);
	});

	test("should filter users by partial email", async ({ request }) => {
		const agencyApiClient = new AgencyAPIClient(request);
		const response = await agencyApiClient.filterUsers(mainAgencyToken, {
			filter_email: "user",
			limit: 10,
		});
		expect(response.status).toBe(200);
		const matching = response.body!.items.filter((u) =>
			u.email_address.includes("user")
		);
		expect(matching.length).toBeGreaterThanOrEqual(3);
	});

	test("should filter users by status", async ({ request }) => {
		const agencyApiClient = new AgencyAPIClient(request);
		const response = await agencyApiClient.filterUsers(mainAgencyToken, {
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
		const agencyApiClient = new AgencyAPIClient(request);
		const res1 = await agencyApiClient.filterUsers(mainAgencyToken, {
			limit: 2,
		});
		expect(res1.body!.items.length).toBe(2);
		const cursor = res1.body!.next_cursor;
		expect(cursor).toBeTruthy();

		const res2 = await agencyApiClient.filterUsers(mainAgencyToken, {
			limit: 2,
			cursor: cursor,
		});
		expect(res2.body!.items.length).toBeGreaterThan(0);
		expect(res2.body!.items[0].email_address).not.toBe(
			res1.body!.items[1].email_address
		);
	});
});
