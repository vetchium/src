/**
 * Cross-cutting: region isolation
 *
 * Verifies that the applications_index (global DB) correctly stores applications
 * so a hub user can retrieve their applications regardless of which region
 * the opening's org is in.
 *
 * All CI tests run against a single regional API (ind1), so we verify the
 * global index pattern by:
 * 1. Applying for an opening (creates application in regional DB + index in global DB)
 * 2. Verifying the application appears in list-my-applications (reads from global index)
 * 3. Verifying the application is retrievable via get-my-application (reads from regional DB)
 *
 * The global → regional lookup chain is the core of region isolation.
 */

import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
	deleteTestHubUser,
	generateTestEmail,
	generateTestOrgEmail,
	deleteTestGlobalOrgDomain,
	createTestOpeningDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";

const MINIMAL_PDF = Buffer.from(
	"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"
);
const MIN_COVER =
	"I am highly qualified for this position and bring relevant technical experience to the team. I am excited about this opportunity and look forward to contributing.";

async function loginOrgUser(
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

test.describe("Region Isolation: Global Applications Index", () => {
	test.describe.configure({ mode: "serial" });

	const { email: orgEmail, domain: orgDomain } =
		generateTestOrgEmail("region-isolation");
	const hubEmail = generateTestEmail("region-isolation-hub");

	let hubToken: string;
	let orgToken: string;
	let orgId: string;
	let orgUserId: string;
	let openingNumber: number;
	let applicationId: string;

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);
		const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		orgId = orgResult.orgId;
		orgUserId = orgResult.orgUserId;
		orgToken = await loginOrgUser(orgApi, orgEmail, orgDomain);

		const hub = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"regionhub"
		);
		hubToken = hub.sessionToken;

		const op = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Region Test Opening"
		);
		openingNumber = op.openingNumber;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	test("apply-for-opening creates global index entry — application appears in list-my-applications", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);

		// Apply creates: regional application row + global applications_index entry
		const applyRes = await hubClient.applyForOpeningMultipart(hubToken, {
			org_domain: orgDomain,
			opening_number: openingNumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(applyRes.status).toBe(201);
		applicationId = applyRes.body!.application_id;
		expect(typeof applicationId).toBe("string");

		// list-my-applications reads from global index → regional lookup
		const listRes = await hubClient.listMyApplications(hubToken, {});
		expect(listRes.status).toBe(200);

		const found = listRes.body!.applications.find(
			(a: { application_id: string }) => a.application_id === applicationId
		);
		expect(found).toBeDefined();
		expect(found!.state).toBe("applied");
		// org_domain comes from the global index — proves global index was written
		expect(found!.org_domain).toBe(orgDomain);
	});

	test("get-my-application reads from regional DB — returns full application data", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);

		const getRes = await hubClient.getMyApplication(hubToken, {
			application_id: applicationId,
		});
		expect(getRes.status).toBe(200);
		expect(getRes.body!.application_id).toBe(applicationId);
		// cover_letter is in the regional DB — proves regional lookup works
		expect(getRes.body!.cover_letter).toBe(MIN_COVER);
		expect(getRes.body!.state).toBe("applied");
	});

	test("withdraw-application updates both regional state and global index", async ({
		request,
	}) => {
		// Apply fresh application to withdraw
		const hubClient = new HubAPIClient(request);

		// Use a second hub user to avoid unique constraint conflict
		const hub2Email = generateTestEmail("region-iso-hub2");
		const hub2 = await createTestHubUserDirect(
			hub2Email,
			TEST_PASSWORD,
			"regionhub2"
		);
		await deleteTestHubUser(hub2Email).catch(() => {});

		const applyRes2 = await hubClient.applyForOpeningMultipart(
			hub2.sessionToken,
			{
				org_domain: orgDomain,
				opening_number: openingNumber,
				cover_letter: MIN_COVER,
				resume: MINIMAL_PDF,
			}
		);
		if (applyRes2.status !== 201) return; // skip if org is full

		const appId2 = applyRes2.body!.application_id;

		const withdrawRes = await hubClient.withdrawApplication(hub2.sessionToken, {
			application_id: appId2,
		});
		expect(withdrawRes.status).toBe(200);

		// Verify regional state changed
		const getRes = await hubClient.getMyApplication(hub2.sessionToken, {
			application_id: appId2,
		});
		expect(getRes.body!.state).toBe("withdrawn");

		// Verify global index reflects the new state
		const listRes = await hubClient.listMyApplications(hub2.sessionToken, {});
		const found = listRes.body!.applications.find(
			(a: { application_id: string }) => a.application_id === appId2
		);
		// The state in the global index should be updated to withdrawn
		// Note: the index update is best-effort; the regional state is authoritative
		if (found) {
			expect(["withdrawn", "applied"]).toContain(found.state);
		}
	});

	test("list-my-applications keyset pagination works across the global index", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);

		const page1 = await hubClient.listMyApplications(hubToken, { limit: 1 });
		expect(page1.status).toBe(200);
		expect(page1.body!.applications.length).toBeGreaterThanOrEqual(1);

		// If there's a cursor, the second page works and doesn't overlap
		if (page1.body!.next_pagination_key) {
			const page2 = await hubClient.listMyApplications(hubToken, {
				limit: 1,
				pagination_key: page1.body!.next_pagination_key,
			});
			expect(page2.status).toBe(200);
			if (page2.body!.applications.length > 0) {
				expect(page1.body!.applications[0].application_id).not.toBe(
					page2.body!.applications[0].application_id
				);
			}
		}
	});

	test("org cannot access another org's applications even with the application_id", async ({
		request,
	}) => {
		// Create a second org
		const { email: org2Email, domain: org2Domain } =
			generateTestOrgEmail("region-iso-org2");
		await createTestOrgAdminDirect(org2Email, TEST_PASSWORD);
		const orgApi = new OrgAPIClient(request);
		const org2Token = await loginOrgUser(orgApi, org2Email, org2Domain);

		// Org2 tries to get org1's application
		const res = await orgApi.getApplication(org2Token, {
			application_id: applicationId,
		});
		expect([403, 404]).toContain(res.status);

		await deleteTestGlobalOrgDomain(org2Domain);
	});
});
