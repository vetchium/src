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
import type {
	CreateOpeningRequest,
	ListOpeningsRequest,
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

test.describe("Openings — List Filters", () => {
	test.describe.configure({ mode: "serial" });

	let adminEmail = "";
	let recruiterEmail = "";
	let domain = "";
	let token = "";
	const { email: adminGenEmail, domain: adminGenDomain } =
		generateTestOrgEmail("op-filter");

	test.beforeAll(async ({ request }) => {
		const api = new OrgAPIClient(request);
		const result = await createTestOrgAdminDirect(adminGenEmail, TEST_PASSWORD);
		adminEmail = adminGenEmail;
		domain = adminGenDomain;

		recruiterEmail = `rec@${domain}`;
		await createTestOrgUserDirect(recruiterEmail, TEST_PASSWORD, "ind1", {
			orgId: result.orgId,
			domain,
		});

		token = await loginOrgUser(api, adminEmail, domain);

		// Create address
		const addrRes = await api.createAddress(token, {
			title: "HQ",
			address_line1: "1 St",
			city: "Chennai",
			country: "IN",
		} as CreateAddressRequest);
		const addressId = addrRes.body!.address_id;

		// Opening A: Frontend Engineer (published, public, full_time)
		const aRes = await api.createOpening(token, {
			title: "Frontend Engineer",
			description: "Build UIs",
			is_internal: false,
			employment_type: "full_time",
			work_location_type: "remote",
			address_ids: [addressId],
			number_of_positions: 1,
			hiring_manager_email_address: adminEmail,
			recruiter_email_address: recruiterEmail,
		} as CreateOpeningRequest);
		await api.submitOpening(token, {
			opening_number: aRes.body!.opening_number,
		});

		// Opening B: Frontend Designer (draft, internal, part_time)
		await api.createOpening(token, {
			title: "Frontend Designer",
			description: "Design UIs",
			is_internal: true,
			employment_type: "part_time",
			work_location_type: "remote",
			address_ids: [addressId],
			number_of_positions: 1,
			hiring_manager_email_address: adminEmail,
			recruiter_email_address: recruiterEmail,
		} as CreateOpeningRequest);

		// Opening C: Backend Engineer (draft, public, contract)
		await api.createOpening(token, {
			title: "Backend Engineer",
			description: "Build APIs",
			is_internal: false,
			employment_type: "contract",
			work_location_type: "remote",
			address_ids: [addressId],
			number_of_positions: 1,
			hiring_manager_email_address: recruiterEmail,
			recruiter_email_address: adminEmail,
		} as CreateOpeningRequest);
	});

	test.afterAll(async () => {
		await deleteTestOrgUser(adminEmail);
		await deleteTestOrgUser(recruiterEmail);
	});

	test("filter_status=['published'] → only Opening A", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const req: ListOpeningsRequest = { filter_status: ["published"] };
		const res = await api.listOpenings(token, req);
		expect(res.status).toBe(200);
		expect(res.body!.openings.every((o) => o.status === "published")).toBe(
			true
		);
		expect(
			res.body!.openings.some((o) => o.title === "Frontend Engineer")
		).toBe(true);
		expect(
			res.body!.openings.some((o) => o.title === "Frontend Designer")
		).toBe(false);
		expect(
			res.body!.openings.some((o) => o.title === "Backend Engineer")
		).toBe(false);
	});

	test("filter_status=['draft'] → Opening B and C", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listOpenings(token, { filter_status: ["draft"] });
		expect(res.status).toBe(200);
		const titles = res.body!.openings.map((o) => o.title);
		expect(titles).toContain("Frontend Designer");
		expect(titles).toContain("Backend Engineer");
		expect(titles).not.toContain("Frontend Engineer");
	});

	test("filter_is_internal=true → only Opening B", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listOpenings(token, { filter_is_internal: true });
		expect(res.status).toBe(200);
		expect(res.body!.openings.every((o) => o.is_internal === true)).toBe(true);
		expect(
			res.body!.openings.some((o) => o.title === "Frontend Designer")
		).toBe(true);
	});

	test("filter_is_internal=false → Opening A and C", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.listOpenings(token, {
			filter_is_internal: false,
		});
		expect(res.status).toBe(200);
		expect(res.body!.openings.every((o) => o.is_internal === false)).toBe(
			true
		);
	});

	test("filter_title_prefix='Frontend' → Opening A and B", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listOpenings(token, {
			filter_title_prefix: "Frontend",
		});
		expect(res.status).toBe(200);
		const titles = res.body!.openings.map((o) => o.title);
		expect(titles).toContain("Frontend Engineer");
		expect(titles).toContain("Frontend Designer");
		expect(titles).not.toContain("Backend Engineer");
	});

	test("filter_title_prefix='Backend' → only Opening C", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listOpenings(token, {
			filter_title_prefix: "Backend",
		});
		expect(res.status).toBe(200);
		expect(res.body!.openings.length).toBeGreaterThanOrEqual(1);
		expect(res.body!.openings[0].title).toBe("Backend Engineer");
	});

	test("combined filters: status=draft + is_internal=true", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const res = await api.listOpenings(token, {
			filter_status: ["draft"],
			filter_is_internal: true,
		});
		expect(res.status).toBe(200);
		expect(res.body!.openings.length).toBeGreaterThanOrEqual(1);
		expect(
			res.body!.openings.some((o) => o.title === "Frontend Designer")
		).toBe(true);
	});

	test("pagination with limit=1", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const page1 = await api.listOpenings(token, { limit: 1 });
		expect(page1.status).toBe(200);
		expect(page1.body!.openings.length).toBe(1);

		if (page1.body!.next_pagination_key) {
			const page2 = await api.listOpenings(token, {
				limit: 1,
				pagination_key: page1.body!.next_pagination_key,
			});
			expect(page2.status).toBe(200);
			expect(page2.body!.openings.length).toBe(1);
			expect(page2.body!.openings[0].opening_number).not.toBe(
				page1.body!.openings[0].opening_number
			);
		}
	});

	test("filter with tag_ids", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const tagId = generateTestTagId("op-filter-tag");
		await createTestTag(tagId);

		try {
			// Note: Would need to create an opening with the tag first
			// For now, just verify the filter parameter works
			const res = await api.listOpenings(token, {
				filter_tag_ids: [tagId],
			});
			expect(res.status).toBe(200);
		} finally {
			await deleteTestTag(tagId);
		}
	});
});
