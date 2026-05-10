import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	assignRoleToOrgUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type {
	CreateOpeningRequest,
	OpeningNumberRequest,
} from "vetchium-specs/org/openings";
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

test.describe("Openings — RBAC", () => {
	test("get-opening: no roles → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-rbac-get-no");
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: noRoleEmail } = await createTestOrgUserDirect(
			`norole@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const adminToken = await loginOrgUser(api, adminEmail, domain);

			// Admin creates opening
			const addrRes = await api.createAddress(adminToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(adminToken, {
				title: "Test Opening",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: noRoleEmail,
			} as CreateOpeningRequest);

			// No-role user tries to get opening
			const noRoleToken = await loginOrgUser(api, noRoleEmail, domain);
			const res = await api.getOpening(noRoleToken, {
				opening_number: createRes.body!.opening_number,
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(noRoleEmail);
		}
	});

	test("get-opening: manage_openings → 200", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-rbac-get-mgr");
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: managerEmail, orgUserId: managerUserId } =
			await createTestOrgUserDirect(`mgr@${domain}`, TEST_PASSWORD, "ind1", {
				orgId,
				domain,
			});
		await assignRoleToOrgUser(managerUserId, "org:manage_openings", "ind1");

		try {
			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const managerToken = await loginOrgUser(api, managerEmail, domain);

			const addrRes = await api.createAddress(adminToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(adminToken, {
				title: "Test Opening",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: managerEmail,
			} as CreateOpeningRequest);

			const res = await api.getOpening(managerToken, {
				opening_number: createRes.body!.opening_number,
			});
			expect(res.status).toBe(200);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(managerEmail);
		}
	});

	test("update-opening: no roles → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-rbac-upd-no");
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: noRoleEmail } = await createTestOrgUserDirect(
			`norole@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const noRoleToken = await loginOrgUser(api, noRoleEmail, domain);

			const addrRes = await api.createAddress(adminToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(adminToken, {
				title: "Test Opening",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: noRoleEmail,
			} as CreateOpeningRequest);

			const res = await api.updateOpening(noRoleToken, {
				opening_number: createRes.body!.opening_number,
				title: "Updated",
				description: "Updated",
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: noRoleEmail,
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(noRoleEmail);
		}
	});

	test("submit-opening: no roles → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-rbac-sub-no");
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: noRoleEmail } = await createTestOrgUserDirect(
			`norole@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const noRoleToken = await loginOrgUser(api, noRoleEmail, domain);

			const addrRes = await api.createAddress(adminToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(adminToken, {
				title: "Test Opening",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: noRoleEmail,
			} as CreateOpeningRequest);

			const res = await api.submitOpening(noRoleToken, {
				opening_number: createRes.body!.opening_number,
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(noRoleEmail);
		}
	});

	test("approve-opening: no roles → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-rbac-app-no");
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: managerEmail, orgUserId: managerUserId } =
			await createTestOrgUserDirect(`mgr@${domain}`, TEST_PASSWORD, "ind1", {
				orgId,
				domain,
			});
		const { email: noRoleEmail } = await createTestOrgUserDirect(
			`norole@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);
		await assignRoleToOrgUser(managerUserId, "org:manage_openings", "ind1");

		try {
			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const managerToken = await loginOrgUser(api, managerEmail, domain);
			const noRoleToken = await loginOrgUser(api, noRoleEmail, domain);

			const addrRes = await api.createAddress(adminToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(managerToken, {
				title: "Test Opening",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: managerEmail,
				recruiter_email_address: adminEmail,
			} as CreateOpeningRequest);

			await api.submitOpening(managerToken, {
				opening_number: createRes.body!.opening_number,
			});

			const res = await api.approveOpening(noRoleToken, {
				opening_number: createRes.body!.opening_number,
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(managerEmail);
			await deleteTestOrgUser(noRoleEmail);
		}
	});

	test("pause-opening: no roles → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-rbac-pause-no");
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: noRoleEmail } = await createTestOrgUserDirect(
			`norole@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const noRoleToken = await loginOrgUser(api, noRoleEmail, domain);

			const addrRes = await api.createAddress(adminToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(adminToken, {
				title: "Test Opening",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: noRoleEmail,
			} as CreateOpeningRequest);

			await api.submitOpening(adminToken, {
				opening_number: createRes.body!.opening_number,
			});

			const res = await api.pauseOpening(noRoleToken, {
				opening_number: createRes.body!.opening_number,
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(noRoleEmail);
		}
	});

	test("close-opening: no roles → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-rbac-close-no");
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: noRoleEmail } = await createTestOrgUserDirect(
			`norole@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const noRoleToken = await loginOrgUser(api, noRoleEmail, domain);

			const addrRes = await api.createAddress(adminToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(adminToken, {
				title: "Test Opening",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: noRoleEmail,
			} as CreateOpeningRequest);

			await api.submitOpening(adminToken, {
				opening_number: createRes.body!.opening_number,
			});

			const res = await api.closeOpening(noRoleToken, {
				opening_number: createRes.body!.opening_number,
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(noRoleEmail);
		}
	});

	test("discard-opening: no roles → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-rbac-disc-no");
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: noRoleEmail } = await createTestOrgUserDirect(
			`norole@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const noRoleToken = await loginOrgUser(api, noRoleEmail, domain);

			const addrRes = await api.createAddress(adminToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(adminToken, {
				title: "Test Opening",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: noRoleEmail,
			} as CreateOpeningRequest);

			const res = await api.discardOpening(noRoleToken, {
				opening_number: createRes.body!.opening_number,
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(noRoleEmail);
		}
	});

	test("duplicate-opening: no roles → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("op-rbac-dup-no");
		const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { email: noRoleEmail } = await createTestOrgUserDirect(
			`norole@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);

		try {
			const adminToken = await loginOrgUser(api, adminEmail, domain);
			const noRoleToken = await loginOrgUser(api, noRoleEmail, domain);

			const addrRes = await api.createAddress(adminToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(adminToken, {
				title: "Test Opening",
				description: "Test",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: noRoleEmail,
			} as CreateOpeningRequest);

			const res = await api.duplicateOpening(noRoleToken, {
				opening_number: createRes.body!.opening_number,
			});
			expect(res.status).toBe(403);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(noRoleEmail);
		}
	});
});
