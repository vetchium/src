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

async function createMinimalOpening(request: any, prefix: string) {
	const api = new OrgAPIClient(request);
	const { email: adminEmail, domain } = generateTestOrgEmail(prefix);
	const { orgId } = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
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
	const req: CreateOpeningRequest = {
		title: "State Test Opening",
		description: "For state transition tests",
		is_internal: false,
		employment_type: "full_time",
		work_location_type: "remote",
		address_ids: [addrRes.body!.address_id],
		number_of_positions: 1,
		hiring_manager_email_address: adminEmail,
		recruiter_email_address: recruiterEmail,
	};
	const res = await api.createOpening(token, req);
	return {
		api,
		token,
		openingNumber: res.body!.opening_number,
		adminEmail,
		recruiterEmail,
		domain,
		orgId,
	};
}

test.describe("Openings — Invalid State Transitions", () => {
	test("discard non-draft (published) opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-discard-pub");
		const {
			api,
			token,
			openingNumber,
			adminEmail,
			recruiterEmail,
		} = setup;

		try {
			// Draft → published (superadmin)
			await api.submitOpening(token, { opening_number: openingNumber });

			// Try to discard published → expect 422
			const res = await api.discardOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("discard pending_review opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-discard-review");
		const {
			api,
			token,
			openingNumber,
			adminEmail,
			recruiterEmail,
			domain,
			orgId,
		} = setup;

		try {
			// Create manager with manage_openings role
			const { email: managerEmail, orgUserId: managerUserId } =
				await createTestOrgUserDirect(`mgr@${domain}`, TEST_PASSWORD, "ind1", {
					orgId,
					domain,
				});
			await assignRoleToOrgUser(managerUserId, "org:manage_openings", "ind1");

			// Manager submits the admin's existing draft opening → pending_review
			const managerToken = await loginOrgUser(api, managerEmail, domain);
			await api.submitOpening(managerToken, { opening_number: openingNumber });

			// Try to discard pending_review → expect 422
			const res = await api.discardOpening(managerToken, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);

			await deleteTestOrgUser(managerEmail);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("update published opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-update-pub");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			// Submit to published
			await api.submitOpening(token, { opening_number: openingNumber });

			// Try to update → expect 422
			const getRes = await api.getOpening(token, {
				opening_number: openingNumber,
			});
			const res = await api.updateOpening(token, {
				opening_number: openingNumber,
				title: "Updated",
				description: "Updated desc",
				employment_type: getRes.body!.employment_type,
				work_location_type: getRes.body!.work_location_type,
				address_ids: getRes.body!.addresses.map((a) => a.address_id),
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

	test("update pending_review opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-update-review");
		const {
			api,
			token,
			openingNumber,
			adminEmail,
			recruiterEmail,
			domain,
			orgId,
		} = setup;

		try {
			// Create manager with manage_openings role
			const { email: managerEmail, orgUserId: managerUserId } =
				await createTestOrgUserDirect(`mgr@${domain}`, TEST_PASSWORD, "ind1", {
					orgId,
					domain,
				});
			await assignRoleToOrgUser(managerUserId, "org:manage_openings", "ind1");

			const managerToken = await loginOrgUser(api, managerEmail, domain);

			// Manager submits the admin's existing draft opening → pending_review
			await api.submitOpening(managerToken, { opening_number: openingNumber });

			// Try to update pending_review → expect 422
			const getRes = await api.getOpening(managerToken, {
				opening_number: openingNumber,
			});
			const res = await api.updateOpening(managerToken, {
				opening_number: openingNumber,
				title: "Updated",
				description: "Updated desc",
				employment_type: getRes.body!.employment_type,
				work_location_type: getRes.body!.work_location_type,
				address_ids: getRes.body!.addresses.map((a) => a.address_id),
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
			});
			expect(res.status).toBe(422);

			await deleteTestOrgUser(managerEmail);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("submit a published opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-submit-pub");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			// Submit to published
			await api.submitOpening(token, { opening_number: openingNumber });

			// Try to submit again → expect 422
			const res = await api.submitOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("submit a closed opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-submit-closed");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			// Draft → published → closed
			await api.submitOpening(token, { opening_number: openingNumber });
			await api.closeOpening(token, { opening_number: openingNumber });

			// Try to submit closed → expect 422
			const res = await api.submitOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("pause a draft opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-pause-draft");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			const res = await api.pauseOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("pause a pending_review opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-pause-review");
		const {
			api,
			token,
			openingNumber,
			adminEmail,
			recruiterEmail,
			domain,
			orgId,
		} = setup;

		try {
			const { email: managerEmail, orgUserId: managerUserId } =
				await createTestOrgUserDirect(`mgr@${domain}`, TEST_PASSWORD, "ind1", {
					orgId,
					domain,
				});
			await assignRoleToOrgUser(managerUserId, "org:manage_openings", "ind1");

			const managerToken = await loginOrgUser(api, managerEmail, domain);

			// Manager submits the admin's existing draft opening → pending_review
			await api.submitOpening(managerToken, { opening_number: openingNumber });

			const res = await api.pauseOpening(managerToken, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);

			await deleteTestOrgUser(managerEmail);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("pause a closed opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-pause-closed");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			await api.submitOpening(token, { opening_number: openingNumber });
			await api.closeOpening(token, { opening_number: openingNumber });

			const res = await api.pauseOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("reopen a draft opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-reopen-draft");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			const res = await api.reopenOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("reopen a published opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-reopen-pub");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			await api.submitOpening(token, { opening_number: openingNumber });

			const res = await api.reopenOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("approve a draft opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-approve-draft");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			const res = await api.approveOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("approve a published opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-approve-pub");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			await api.submitOpening(token, { opening_number: openingNumber });

			const res = await api.approveOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("reject a draft opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-reject-draft");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			const res = await api.rejectOpening(token, {
				opening_number: openingNumber,
				rejection_note: "Test rejection",
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("reject a published opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-reject-pub");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			await api.submitOpening(token, { opening_number: openingNumber });

			const res = await api.rejectOpening(token, {
				opening_number: openingNumber,
				rejection_note: "Test rejection",
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("close a draft opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-close-draft");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			const res = await api.closeOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("close a pending_review opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-close-review");
		const {
			api,
			token,
			openingNumber,
			adminEmail,
			recruiterEmail,
			domain,
			orgId,
		} = setup;

		try {
			const { email: managerEmail, orgUserId: managerUserId } =
				await createTestOrgUserDirect(`mgr@${domain}`, TEST_PASSWORD, "ind1", {
					orgId,
					domain,
				});
			await assignRoleToOrgUser(managerUserId, "org:manage_openings", "ind1");

			const managerToken = await loginOrgUser(api, managerEmail, domain);

			// Manager submits the admin's existing draft opening → pending_review
			await api.submitOpening(managerToken, { opening_number: openingNumber });

			const res = await api.closeOpening(managerToken, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);

			await deleteTestOrgUser(managerEmail);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("archive a draft opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-archive-draft");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			const res = await api.archiveOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("archive a published opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-archive-pub");
		const { api, token, openingNumber, adminEmail, recruiterEmail } = setup;

		try {
			await api.submitOpening(token, { opening_number: openingNumber });

			const res = await api.archiveOpening(token, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});

	test("archive a pending_review opening → 422", async ({ request }) => {
		const setup = await createMinimalOpening(request, "op-archive-review");
		const {
			api,
			token,
			openingNumber,
			adminEmail,
			recruiterEmail,
			domain,
			orgId,
		} = setup;

		try {
			const { email: managerEmail, orgUserId: managerUserId } =
				await createTestOrgUserDirect(`mgr@${domain}`, TEST_PASSWORD, "ind1", {
					orgId,
					domain,
				});
			await assignRoleToOrgUser(managerUserId, "org:manage_openings", "ind1");

			const managerToken = await loginOrgUser(api, managerEmail, domain);

			// Manager submits the admin's existing draft opening → pending_review
			await api.submitOpening(managerToken, { opening_number: openingNumber });

			const res = await api.archiveOpening(managerToken, {
				opening_number: openingNumber,
			});
			expect(res.status).toBe(422);

			await deleteTestOrgUser(managerEmail);
		} finally {
			await deleteTestOrgUser(adminEmail);
			await deleteTestOrgUser(recruiterEmail);
		}
	});
});
