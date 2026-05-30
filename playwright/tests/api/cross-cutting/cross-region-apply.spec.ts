/**
 * Cross-cutting: cross-region hiring lifecycle.
 *
 * Hiring data lives in the OPENING's region (the org's home region). A hub user
 * authenticates against their OWN home region, which may differ. This verifies
 * that a hub user in one region (ind1) can apply to, read, and withdraw from an
 * opening that lives in another region (usa1) — i.e. the handlers resolve the
 * opening's region rather than assuming the caller's region.
 *
 * The ind1 API server (localhost:8080) is wired with all regional DB pools and
 * S3 configs, so it can read/write usa1 data on behalf of an ind1 hub user.
 */

import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
	createTestOpeningDirect,
	deleteTestHubUser,
	deleteTestGlobalOrgDomain,
	generateTestEmail,
	generateTestOrgEmail,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

const MINIMAL_PDF = Buffer.from(
	"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
		"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
		"3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\n" +
		"xref\n0 4\n0000000000 65535 f\n" +
		"trailer<</Size 4/Root 1 0 R>>\nstartxref\n%%EOF\n"
);

const MIN_COVER =
	"I am applying from a different region than this opening. I have extensive relevant experience and am excited to contribute to the team's continued success.";

test.describe("Cross-region hiring lifecycle", () => {
	test.describe.configure({ mode: "serial" });

	// Org + opening live in usa1; the applicant lives in ind1.
	const { email: orgEmail, domain: orgDomain } =
		generateTestOrgEmail("xregion-org");
	let orgId: string;
	let orgUserId: string;
	let openingNumber: number;
	const hubEmailsToCleanup: string[] = [];

	test.beforeAll(async () => {
		const org = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD, "usa1");
		orgId = org.orgId;
		orgUserId = org.orgUserId;
		const opening = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Cross-Region Role",
			"usa1"
		);
		openingNumber = opening.openingNumber;
	});

	test.afterAll(async () => {
		for (const email of hubEmailsToCleanup) {
			await deleteTestHubUser(email).catch(() => {});
		}
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	test("ind1 hub user applies to a usa1 opening, reads it, and withdraws", async ({
		request,
	}) => {
		const email = generateTestEmail("xrhub");
		const hub = await createTestHubUserDirect(email, TEST_PASSWORD, "xrhub"); // ind1
		hubEmailsToCleanup.push(email);
		const hubClient = new HubAPIClient(request);

		// Apply: the handler must resolve the opening's region (usa1) from the
		// domain and write the application there, not in the caller's region.
		const applyRes = await hubClient.applyForOpeningMultipart(
			hub.sessionToken,
			{
				org_domain: orgDomain,
				opening_number: openingNumber,
				cover_letter: MIN_COVER,
				resume: MINIMAL_PDF,
			}
		);
		expect(applyRes.status).toBe(201);
		const applicationId = applyRes.body!.application_id;
		expect(typeof applicationId).toBe("string");

		// get-my-application resolves the region via the global applications_index
		// and reads the full row (incl. cover_letter) from usa1.
		const getRes = await hubClient.getMyApplication(hub.sessionToken, {
			application_id: applicationId,
		});
		expect(getRes.status).toBe(200);
		expect(getRes.body!.state).toBe("applied");
		expect(getRes.body!.cover_letter).toBe(MIN_COVER);

		// list-my-applications builds from the global index; the region recorded
		// must be usa1, and the entry must surface for the ind1 caller.
		const listRes = await hubClient.listMyApplications(hub.sessionToken, {});
		expect(listRes.status).toBe(200);
		const found = listRes.body!.applications.find(
			(a: { application_id: string }) => a.application_id === applicationId
		);
		expect(found).toBeDefined();
		expect(found!.org_domain).toBe(orgDomain);

		// Withdraw resolves the region via the index and writes in usa1.
		const withdrawRes = await hubClient.withdrawApplication(hub.sessionToken, {
			application_id: applicationId,
		});
		expect(withdrawRes.status).toBe(200);

		const afterWithdraw = await hubClient.getMyApplication(hub.sessionToken, {
			application_id: applicationId,
		});
		expect(afterWithdraw.status).toBe(200);
		expect(afterWithdraw.body!.state).toBe("withdrawn");
	});
});
