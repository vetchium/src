import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	createTestMarketplaceListingDirect,
	createTestMarketplaceSubscriptionDirect,
	assignRoleToOrgUser,
	deleteTestOrgUser,
	deleteTestGlobalOrgDomain,
	generateTestOrgEmail,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type { ListStaffingClientsResponse } from "vetchium-specs/org/agency-referrals";

const BASE = "http://localhost:8080";

async function loginOrg(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginReq: OrgLoginRequest = { email, domain, password: TEST_PASSWORD };
	const loginRes = await api.login(loginReq);
	expect(loginRes.status).toBe(200);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRes = await api.verifyTFA({
		tfa_token: loginRes.body!.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	} as OrgTFARequest);
	expect(tfaRes.status).toBe(200);
	return tfaRes.body!.session_token;
}

test.describe("List Staffing Clients", () => {
	test.describe.configure({ mode: "serial" });

	const { email: consumerEmail, domain: consumerDomain } =
		generateTestOrgEmail("staff-cli-consumer");
	const { email: agencyEmail, domain: agencyDomain } =
		generateTestOrgEmail("staff-cli-agency");
	// A non-lead recruiter WITH the view role (positive RBAC).
	const recruiterEmail = `recruiter@${agencyDomain}`;
	// An agency user with NO roles (negative RBAC).
	const noRoleEmail = `norole@${agencyDomain}`;

	let agencyToken: string; // lead (superadmin)
	let recruiterToken: string;
	let noRoleToken: string;

	test.beforeAll(async ({ playwright }) => {
		const request = await playwright.request.newContext({ baseURL: BASE });
		const api = new OrgAPIClient(request);

		// Consumer org subscribes to the agency's staffing listing. No opening is
		// ever assigned — the consumer must still surface as a staffing client.
		const consumer = await createTestOrgAdminDirect(
			consumerEmail,
			TEST_PASSWORD
		);

		const agency = await createTestOrgAdminDirect(agencyEmail, TEST_PASSWORD);
		agencyToken = await loginOrg(api, agencyEmail, agencyDomain);

		// Non-lead recruiter in the agency org with the agency-side view role.
		const recruiter = await createTestOrgUserDirect(
			recruiterEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: agency.orgId, domain: agencyDomain }
		);
		await assignRoleToOrgUser(recruiter.orgUserId, "org:view_agency_referrals");
		recruiterToken = await loginOrg(api, recruiterEmail, agencyDomain);

		// Agency user with no roles at all (negative RBAC).
		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId: agency.orgId,
			domain: agencyDomain,
		});
		noRoleToken = await loginOrg(api, noRoleEmail, agencyDomain);

		// Agency publishes a staffing listing; consumer subscribes (active).
		const listing = await createTestMarketplaceListingDirect(
			agency.orgId,
			agencyDomain,
			["staffing"],
			"active"
		);
		await createTestMarketplaceSubscriptionDirect(
			consumer.orgId,
			"ind1",
			agency.orgId,
			"ind1",
			listing.listingId
		);

		await request.dispose();
	});

	test.afterAll(async () => {
		await deleteTestOrgUser(recruiterEmail).catch(() => {});
		await deleteTestOrgUser(noRoleEmail).catch(() => {});
		await deleteTestOrgUser(consumerEmail).catch(() => {});
		await deleteTestOrgUser(agencyEmail).catch(() => {});
		await deleteTestGlobalOrgDomain(consumerDomain).catch(() => {});
		await deleteTestGlobalOrgDomain(agencyDomain).catch(() => {});
	});

	test("401 without auth", async ({ request }) => {
		const res = await request.post("/org/list-staffing-clients", { data: {} });
		expect(res.status()).toBe(401);
	});

	test("lead sees the freshly-subscribed client (no opening assigned)", async ({
		request,
	}) => {
		const res = await request.post("/org/list-staffing-clients", {
			headers: { Authorization: `Bearer ${agencyToken}` },
			data: {},
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as ListStaffingClientsResponse;
		const entry = body.clients.find(
			(c) => c.consumer_org_domain === consumerDomain
		);
		expect(entry).toBeDefined();
		expect(entry!.consumer_org_name).toBeTruthy();
		// The agency must never list itself as a client.
		expect(
			body.clients.some((c) => c.consumer_org_domain === agencyDomain)
		).toBe(false);
	});

	test("RBAC: non-lead with view role can list (200)", async ({ request }) => {
		const res = await request.post("/org/list-staffing-clients", {
			headers: { Authorization: `Bearer ${recruiterToken}` },
			data: {},
		});
		expect(res.status()).toBe(200);
		const body = (await res.json()) as ListStaffingClientsResponse;
		expect(
			body.clients.some((c) => c.consumer_org_domain === consumerDomain)
		).toBe(true);
	});

	test("RBAC: user with no roles is forbidden (403)", async ({ request }) => {
		const res = await request.post("/org/list-staffing-clients", {
			headers: { Authorization: `Bearer ${noRoleToken}` },
			data: {},
		});
		expect(res.status()).toBe(403);
	});
});
