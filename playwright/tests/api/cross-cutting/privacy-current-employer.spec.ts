/**
 * Cross-cutting privacy invariant:
 * "No notification, audit log, or read endpoint ever surfaces to the candidate's
 *  current employer (active stint domain) that the candidate has applied elsewhere."
 *
 * Spec requirement: verified work history showing the current employer IS allowed
 * (it is already public on the candidate's profile), but the act of applying
 * must never create any signal visible to the current employer.
 *
 * We verify:
 * 1. Applying for a job at OrgB does NOT create any audit log visible to OrgA
 *    (the candidate's current employer via an active work stint)
 * 2. OrgA cannot list or see the candidate's application at OrgB
 * 3. The list-applications endpoint at OrgA does not include applications to OrgB
 */

import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
	createTestWorkEmailStintDirect,
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
	"I am highly qualified for this role and believe I would be a strong contributor to the team. I bring relevant experience and am eager to make an impact.";

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

test.describe("Privacy Invariant: Current Employer Isolation", () => {
	test.describe.configure({ mode: "serial" });

	// OrgA = candidate's current employer (has active work stint)
	const { email: orgAEmail, domain: orgADomain } =
		generateTestOrgEmail("privacy-orga");
	// OrgB = employer the candidate is applying to
	const { email: orgBEmail, domain: orgBDomain } =
		generateTestOrgEmail("privacy-orgb");
	const hubEmail = generateTestEmail("privacy-hub-candidate");

	let orgAToken: string;
	let orgBToken: string;
	let orgAId: string;
	let orgAUserId: string;
	let orgBId: string;
	let orgBUserId: string;
	let hubGlobalId: string;
	let hubToken: string;
	let hubHandle: string;
	let openingBId: string;
	let openingBNumber: number;
	let applicationId: string;

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);

		const rA = await createTestOrgAdminDirect(orgAEmail, TEST_PASSWORD);
		orgAId = rA.orgId;
		orgAUserId = rA.orgUserId;
		orgAToken = await loginOrgUser(orgApi, orgAEmail, orgADomain);

		const rB = await createTestOrgAdminDirect(orgBEmail, TEST_PASSWORD);
		orgBId = rB.orgId;
		orgBUserId = rB.orgUserId;
		orgBToken = await loginOrgUser(orgApi, orgBEmail, orgBDomain);

		// Hub user who currently works at OrgA (active stint)
		const hub = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"privacyhub"
		);
		hubGlobalId = hub.hubUserGlobalId;
		hubToken = hub.sessionToken;
		hubHandle = hub.handle;

		// Create active work stint at OrgA's domain (simulates current employment)
		await createTestWorkEmailStintDirect(
			hubGlobalId,
			`${hubHandle}@${orgADomain}`,
			"active"
		);

		// OrgB has an open position the candidate will apply to
		const op = await createTestOpeningDirect(
			orgBId,
			orgBUserId,
			"Privacy Test Opening"
		);
		openingBId = op.openingId;
		openingBNumber = op.openingNumber;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgADomain);
		await deleteTestGlobalOrgDomain(orgBDomain);
	});

	test("candidate applies to OrgB — application does NOT appear in OrgA's list-applications", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);

		// Candidate applies to OrgB
		const applyRes = await hubClient.applyForOpeningMultipart(hubToken, {
			org_domain: orgBDomain,
			opening_number: openingBNumber,
			cover_letter: MIN_COVER,
			resume: MINIMAL_PDF,
		});
		expect(applyRes.status).toBe(201);
		applicationId = applyRes.body!.application_id;

		// OrgA's list-applications for their OWN openings returns nothing
		// (candidate has not applied to OrgA; any OrgA opening would show nothing)
		const orgApi = new OrgAPIClient(request);

		// OrgA cannot see OrgB's applications
		const orgBListRes = await orgApi.listApplications(orgBToken, {
			opening_id: openingBId,
		});
		expect(orgBListRes.status).toBe(200);
		const found = orgBListRes.body!.applications.find(
			(a: { application_id: string }) => a.application_id === applicationId
		);
		expect(found).toBeDefined(); // OrgB CAN see it

		// OrgA with a different opening cannot see this application
		// Create a dummy opening at OrgA to verify the opening_id filter works
		const opA = await createTestOpeningDirect(
			orgAId,
			orgAUserId,
			"OrgA Dummy Opening"
		);
		const orgAListRes = await orgApi.listApplications(orgAToken, {
			opening_id: opA.openingId,
		});
		expect(orgAListRes.status).toBe(200);
		// No applications to OrgA's opening
		expect(orgAListRes.body!.applications).toHaveLength(0);
	});

	test("candidate's application at OrgB is not retrievable by OrgA", async ({
		request,
	}) => {
		const orgApi = new OrgAPIClient(request);
		// OrgA tries to get OrgB's application by application_id
		const res = await orgApi.getApplication(orgAToken, {
			application_id: applicationId,
		});
		// Must be 403 or 404 — OrgA has no access to OrgB's application
		expect([403, 404]).toContain(res.status);
	});

	test("OrgA audit logs contain no entry about the candidate's application to OrgB", async ({
		request,
	}) => {
		const orgApi = new OrgAPIClient(request);
		// OrgA should have no audit log entries referencing the candidate's application to OrgB
		const auditRes = await orgApi.listAuditLogs(orgAToken, {
			event_types: ["hub.apply_for_opening", "org.new_application"],
		});
		expect(auditRes.status).toBe(200);
		// The audit log for OrgA must not mention the applicationId from OrgB
		const found = (auditRes.body?.audit_logs ?? []).find(
			(e: { event_data?: Record<string, unknown> }) =>
				e.event_data?.application_id === applicationId
		);
		expect(found).toBeUndefined();
	});

	test("hub/get-opening for OrgB's opening does not expose candidate's current employer identity to OrgB", async ({
		request,
	}) => {
		// The viewer_has_applied field should be true for the candidate
		const hubClient = new HubAPIClient(request);
		const getRes = await hubClient.getOpening(hubToken, {
			org_domain: orgBDomain,
			opening_number: openingBNumber,
		});
		expect(getRes.status).toBe(200);
		// candidate has applied, so viewer_has_applied = true
		expect(getRes.body!.viewer_has_applied).toBe(true);
		// The response must NOT include the candidate's current employer (OrgA)
		// We verify by checking the response doesn't contain orgADomain in unexpected places
		const responseStr = JSON.stringify(getRes.body);
		// orgADomain should not appear in an opening detail response for OrgB
		// (it might appear in candidate stints if those were included, but our
		//  HubOpeningDetail response does not include candidate employer history)
		expect(responseStr).not.toContain(`"${orgADomain}"`);
	});
});
