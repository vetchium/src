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
	expect(loginRes.status).toBe(200);

	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaReq: OrgTFARequest = {
		tfa_token: loginRes.body!.tfa_token,
		tfa_code: tfaCode,
		remember_me: true,
	};
	const tfaRes = await api.verifyTFA(tfaReq);
	expect(tfaRes.status).toBe(200);
	return tfaRes.body!.session_token;
}

test.describe("Openings — Audit Logs", () => {
	async function setupTestOpening(request: any, prefix: string) {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } = generateTestOrgEmail(prefix);
		const result = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		const { orgId } = result;
		const { email: recruiterEmail } = await createTestOrgUserDirect(
			`rec@${domain}`,
			TEST_PASSWORD,
			"ind1",
			{ orgId, domain }
		);
		const token = await loginOrgUser(api, adminEmail, domain);

		const addrRes = await api.createAddress(token, {
			title: "HQ",
			address_line1: "1 St",
			city: "Chennai",
			country: "IN",
		} as CreateAddressRequest);

		const createRes = await api.createOpening(token, {
			title: "Audit Test Opening",
			description: "For audit log tests",
			is_internal: false,
			employment_type: "full_time",
			work_location_type: "remote",
			address_ids: [addrRes.body!.address_id],
			number_of_positions: 1,
			hiring_manager_email_address: adminEmail,
			recruiter_email_address: recruiterEmail,
		} as CreateOpeningRequest);

		return {
			api,
			token,
			openingNumber: createRes.body!.opening_number,
			adminEmail,
			recruiterEmail,
			domain,
			orgId,
			addressId: addrRes.body!.address_id,
		};
	}

	test("org.update_opening audit log", async ({ request }) => {
		const setup = await setupTestOpening(request, "op-audit-update");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			const before = new Date(Date.now() - 2000).toISOString();

			const getRes = await api.getOpening(token, {
				opening_number: openingNumber,
			});
			await api.updateOpening(token, {
				opening_number: openingNumber,
				title: "Updated Title",
				description: getRes.body!.description,
				employment_type: getRes.body!.employment_type,
				work_location_type: getRes.body!.work_location_type,
				address_ids: getRes.body!.addresses.map((a) => a.address_id),
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
			});

			const auditResp = await api.listAuditLogs(token, {
				event_types: ["org.update_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe("org.update_opening");
		} finally {
			await deleteTestOrgUser(setup.adminEmail);
			await deleteTestOrgUser(setup.recruiterEmail);
		}
	});

	test("org.submit_opening audit log (non-superadmin → pending_review)", async ({
		request,
	}) => {
		const setup = await setupTestOpening(request, "op-audit-submit");
		const { api, token, adminEmail, recruiterEmail, domain, orgId } = setup;

		try {
			const { email: managerEmail, orgUserId: managerUserId } =
				await createTestOrgUserDirect(`mgr@${domain}`, TEST_PASSWORD, "ind1", {
					orgId,
					domain,
				});
			await assignRoleToOrgUser(managerUserId, "org:manage_openings", "ind1");

			const managerToken = await loginOrgUser(api, managerEmail, domain);

			const addrRes = await api.createAddress(managerToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(managerToken, {
				title: "Audit Test Opening",
				description: "For audit log tests",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: managerEmail,
				recruiter_email_address: adminEmail,
			} as CreateOpeningRequest);

			const before = new Date(Date.now() - 2000).toISOString();
			await api.submitOpening(managerToken, {
				opening_number: createRes.body!.opening_number,
			});

			const auditResp = await api.listAuditLogs(managerToken, {
				event_types: ["org.submit_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe("org.submit_opening");

			await deleteTestOrgUser(managerEmail);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("org.reject_opening audit log", async ({ request }) => {
		const setup = await setupTestOpening(request, "op-audit-reject");
		const { api, token, adminEmail, recruiterEmail, domain, orgId } = setup;

		try {
			const { email: managerEmail, orgUserId: managerUserId } =
				await createTestOrgUserDirect(`mgr@${domain}`, TEST_PASSWORD, "ind1", {
					orgId,
					domain,
				});
			await assignRoleToOrgUser(managerUserId, "org:manage_openings", "ind1");

			const managerToken = await loginOrgUser(api, managerEmail, domain);

			const addrRes = await api.createAddress(managerToken, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);
			const createRes = await api.createOpening(managerToken, {
				title: "Audit Test Opening",
				description: "For audit log tests",
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

			const before = new Date(Date.now() - 2000).toISOString();
			await api.rejectOpening(token, {
				opening_number: createRes.body!.opening_number,
				rejection_note: "Test rejection",
			});

			const auditResp = await api.listAuditLogs(token, {
				event_types: ["org.reject_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe("org.reject_opening");

			await deleteTestOrgUser(managerEmail);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("org.pause_opening audit log", async ({ request }) => {
		const setup = await setupTestOpening(request, "op-audit-pause");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			await api.submitOpening(token, { opening_number: openingNumber });

			const before = new Date(Date.now() - 2000).toISOString();
			await api.pauseOpening(token, { opening_number: openingNumber });

			const auditResp = await api.listAuditLogs(token, {
				event_types: ["org.pause_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe("org.pause_opening");
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("org.reopen_opening audit log", async ({ request }) => {
		const setup = await setupTestOpening(request, "op-audit-reopen");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			await api.submitOpening(token, { opening_number: openingNumber });
			await api.pauseOpening(token, { opening_number: openingNumber });

			const before = new Date(Date.now() - 2000).toISOString();
			await api.reopenOpening(token, { opening_number: openingNumber });

			const auditResp = await api.listAuditLogs(token, {
				event_types: ["org.reopen_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe("org.reopen_opening");
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("org.close_opening audit log", async ({ request }) => {
		const setup = await setupTestOpening(request, "op-audit-close");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			await api.submitOpening(token, { opening_number: openingNumber });

			const before = new Date(Date.now() - 2000).toISOString();
			await api.closeOpening(token, { opening_number: openingNumber });

			const auditResp = await api.listAuditLogs(token, {
				event_types: ["org.close_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe("org.close_opening");
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("org.archive_opening audit log", async ({ request }) => {
		const setup = await setupTestOpening(request, "op-audit-archive");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			await api.submitOpening(token, { opening_number: openingNumber });
			await api.closeOpening(token, { opening_number: openingNumber });

			const before = new Date(Date.now() - 2000).toISOString();
			await api.archiveOpening(token, { opening_number: openingNumber });

			const auditResp = await api.listAuditLogs(token, {
				event_types: ["org.archive_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe("org.archive_opening");
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("org.discard_opening audit log", async ({ request }) => {
		const setup = await setupTestOpening(request, "op-audit-discard");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			const before = new Date(Date.now() - 2000).toISOString();
			await api.discardOpening(token, { opening_number: openingNumber });

			const auditResp = await api.listAuditLogs(token, {
				event_types: ["org.discard_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe("org.discard_opening");
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("org.duplicate_opening audit log", async ({ request }) => {
		const setup = await setupTestOpening(request, "op-audit-duplicate");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			const before = new Date(Date.now() - 2000).toISOString();
			await api.duplicateOpening(token, { opening_number: openingNumber });

			const auditResp = await api.listAuditLogs(token, {
				event_types: ["org.duplicate_opening"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe(
				"org.duplicate_opening"
			);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});
});
