import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
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

test.describe("Openings — Update Errors", () => {
	test("update non-existent opening → 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email, domain } = generateTestOrgEmail("op-upd-err-404");
		await createTestOrgAdminDirect(email, TEST_PASSWORD);

		try {
			const token = await loginOrgUser(api, email, domain);
			const res = await api.updateOpening(token, {
				opening_number: 99999,
				title: "X",
				description: "Y",
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: ["00000000-0000-0000-0000-000000000001"],
				number_of_positions: 1,
				hiring_manager_email_address: "hm@example.com",
				recruiter_email_address: "rec@example.com",
			});
			expect(res.status).toBe(404);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("update-opening without token → 401", async ({ request }) => {
		const response = await request.post("/org/update-opening", {
			data: { opening_number: 1 },
		});
		expect(response.status()).toBe(401);
	});

	test("update-opening with missing title → 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"op-upd-err-no-title"
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
			} as CreateOpeningRequest);

			const res = await api.updateOpening(token, {
				opening_number: createRes.body!.opening_number,
				title: "",
				description: "Updated",
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("update-opening with missing description → 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-upd-err-no-desc");
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
			} as CreateOpeningRequest);

			const res = await api.updateOpening(token, {
				opening_number: createRes.body!.opening_number,
				title: "Updated",
				description: "",
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("update-opening with number_of_positions=0 → 400", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(
			"op-upd-err-zero-pos"
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
			} as CreateOpeningRequest);

			const res = await api.updateOpening(token, {
				opening_number: createRes.body!.opening_number,
				title: "Updated",
				description: "Updated",
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 0,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
			});
			expect(res.status).toBe(400);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("update published opening → 422", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-upd-err-pub");
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
			} as CreateOpeningRequest);

			// Submit to published
			await api.submitOpening(token, {
				opening_number: createRes.body!.opening_number,
			});

			// Try to update
			const res = await api.updateOpening(token, {
				opening_number: createRes.body!.opening_number,
				title: "Updated",
				description: "Updated",
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});
});
