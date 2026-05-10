import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	createTestTag,
	deleteTestTag,
	generateTestTagId,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type { CreateOpeningRequest } from "vetchium-specs/org/openings";
import type { CreateAddressRequest } from "vetchium-specs/org/company-addresses";

async function loginOrgUser(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginReq: OrgLoginRequest = {
		email,
		domain,
		password: TEST_PASSWORD,
	};
	const loginRes = await api.login(loginReq);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaReq: OrgTFARequest = {
		tfa_token: loginRes.body!.tfa_token,
		tfa_code: tfaCode,
		remember_me: true,
	};
	const tfaRes = await api.verifyTFA(tfaReq);
	return tfaRes.body!.session_token;
}

test.describe("Openings — Optional Fields", () => {
	test("min_yoe and max_yoe are stored and returned", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"op-opt-yoe"
		);
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: recruiterEmail } = await createTestOrgUserDirect(
			`rec@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const token = await loginOrgUser(api, adminEmail, domain);

			const addrRes = await api.createAddress(token, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);

			const createRes = await api.createOpening(token, {
				title: "Test",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
				min_yoe: 2,
				max_yoe: 8,
			} as CreateOpeningRequest);

			const getRes = await api.getOpening(token, {
				opening_number: createRes.body!.opening_number,
			});
			expect(getRes.body!.min_yoe).toBe(2);
			expect(getRes.body!.max_yoe).toBe(8);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("salary is stored and returned", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"op-opt-sal"
		);
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: recruiterEmail } = await createTestOrgUserDirect(
			`rec@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const token = await loginOrgUser(api, adminEmail, domain);

			const addrRes = await api.createAddress(token, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);

			const createRes = await api.createOpening(token, {
				title: "Test",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
				salary: {
					min_amount: 50000,
					max_amount: 100000,
					currency: "USD",
				},
			} as CreateOpeningRequest);

			const getRes = await api.getOpening(token, {
				opening_number: createRes.body!.opening_number,
			});
			expect(getRes.body!.salary?.min_amount).toBe(50000);
			expect(getRes.body!.salary?.max_amount).toBe(100000);
			expect(getRes.body!.salary?.currency).toBe("USD");
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("tag_ids are stored and returned", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"op-opt-tag"
		);
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: recruiterEmail } = await createTestOrgUserDirect(
			`rec@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const tagId = generateTestTagId("op-opt");
			await createTestTag(tagId);

			try {
				const token = await loginOrgUser(api, adminEmail, domain);

				const addrRes = await api.createAddress(token, {
					title: "HQ",
					address_line1: "1 St",
					city: "Chennai",
					country: "IN",
				} as CreateAddressRequest);

				const createRes = await api.createOpening(token, {
					title: "Test",
					description: "Test",
					is_internal: false,
					employment_type: "full_time",
					work_location_type: "remote",
					address_ids: [addrRes.body!.address_id],
					number_of_positions: 1,
					hiring_manager_email_address: adminEmail,
					recruiter_email_address: recruiterEmail,
					tag_ids: [tagId],
				} as CreateOpeningRequest);

				const getRes = await api.getOpening(token, {
					opening_number: createRes.body!.opening_number,
				});
				expect(getRes.body!.tags.some((t) => t.tag_id === tagId)).toBe(true);
			} finally {
				await deleteTestTag(tagId);
			}
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("invalid email in hiring_team_member_email_addresses → 400", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"op-opt-inv-team"
		);
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: recruiterEmail } = await createTestOrgUserDirect(
			`rec@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const token = await loginOrgUser(api, adminEmail, domain);

			const addrRes = await api.createAddress(token, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);

			const res = await api.createOpeningRaw(token, {
				title: "Test",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
				hiring_team_member_email_addresses: ["nonexistent@example.com"],
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});
});
