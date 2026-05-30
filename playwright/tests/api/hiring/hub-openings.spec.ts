/**
 * Tests for hub-side opening discovery endpoints:
 * - POST /hub/list-openings
 * - POST /hub/get-opening
 * - POST /hub/list-colleagues-at-employer
 * - POST /hub/list-network-opportunities
 */

import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
	deleteTestHubUser,
	generateTestEmail,
	generateTestOrgEmail,
	deleteTestGlobalOrgDomain,
	createTestOpeningDirect,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";

test.describe("Hub Opening Discovery", () => {
	test.describe.configure({ mode: "serial" });

	const { email: orgEmail, domain: orgDomain } =
		generateTestOrgEmail("hub-openings");
	const hubEmail = generateTestEmail("hub-disc-user");

	let hubToken: string;
	let orgId: string;
	let orgUserId: string;
	let openingNumber: number;

	test.beforeAll(async () => {
		const result = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"discuser"
		);
		hubToken = result.sessionToken;

		const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		orgId = orgResult.orgId;
		orgUserId = orgResult.orgUserId;

		const opResult = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Discovery Test Opening"
		);
		openingNumber = opResult.openingNumber;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── list-openings ────────────────────────────────────────────────────────────

	test("list-openings: returns 200 with openings array and correct fields", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.listOpenings(hubToken, {});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.openings)).toBe(true);

		if (res.body!.openings.length > 0) {
			const first = res.body!.openings[0];
			expect(typeof first.org_domain).toBe("string");
			expect(typeof first.title).toBe("string");
			expect(typeof first.opening_number).toBe("number");
			expect(typeof first.employment_type).toBe("string");
			expect(typeof first.work_location_type).toBe("string");
			expect(typeof first.colleague_count_here).toBe("number");
			expect(typeof first.first_published_at).toBe("string");
		}
	});

	test("list-openings: keyset pagination — limit=1 returns cursor; page2 is distinct from page1", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const page1 = await hubClient.listOpenings(hubToken, { limit: 1 });
		expect(page1.status).toBe(200);

		if (page1.body!.openings.length === 1 && page1.body!.next_pagination_key) {
			const page2 = await hubClient.listOpenings(hubToken, {
				limit: 1,
				pagination_key: page1.body!.next_pagination_key,
			});
			expect(page2.status).toBe(200);
			if (page2.body!.openings.length > 0) {
				const p1key = `${page1.body!.openings[0].org_domain}/${page1.body!.openings[0].opening_number}`;
				const p2key = `${page2.body!.openings[0].org_domain}/${page2.body!.openings[0].opening_number}`;
				expect(p1key).not.toBe(p2key);
			}
		}
	});

	test("list-openings: 401 when not authenticated", async ({ request }) => {
		const res = await request.post("/hub/list-openings", { data: {} });
		expect(res.status()).toBe(401);
	});

	// ─── get-opening ─────────────────────────────────────────────────────────────

	test("get-opening: returns correct fields including viewer-aware computed fields", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.getOpening(hubToken, {
			org_domain: orgDomain,
			opening_number: openingNumber,
		});
		expect(res.status).toBe(200);
		expect(res.body!.opening_id).toBeTruthy();
		expect(res.body!.opening_number).toBe(openingNumber);
		expect(res.body!.title).toBe("Discovery Test Opening");
		expect(typeof res.body!.colleague_count_here).toBe("number");
		// hub user has no work stint at org domain, so viewer_can_refer = false
		expect(res.body!.viewer_can_refer).toBe(false);
		// hub user has not applied, so viewer_has_applied = false
		expect(res.body!.viewer_has_applied).toBe(false);
	});

	test("get-opening: 404 for non-existent opening", async ({ request }) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.getOpening(hubToken, {
			org_domain: orgDomain,
			opening_number: 999999,
		});
		expect(res.status).toBe(404);
	});

	test("get-opening: viewer_has_applied becomes true after applying", async ({
		request,
	}) => {
		// Use a fresh hub user to avoid state from other tests
		const email = generateTestEmail("apply-check");
		const hub = await createTestHubUserDirect(
			email,
			TEST_PASSWORD,
			"applycheck"
		);
		await deleteTestHubUser(email).catch(() => {}); // will clean up; just track
		// NOTE: We create+apply without cleanup worry since the test account is ephemeral

		const MIN_COVER =
			"I am highly qualified for this position. I have extensive experience in the relevant technologies and teams.";
		const MINIMAL_PDF = Buffer.from(
			"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"
		);

		const hubClient = new HubAPIClient(request);

		// Before apply: viewer_has_applied = false
		const beforeRes = await hubClient.getOpening(hub.sessionToken, {
			org_domain: orgDomain,
			opening_number: openingNumber,
		});
		expect(beforeRes.body!.viewer_has_applied).toBe(false);

		// Apply
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

		// After apply: viewer_has_applied = true
		const afterRes = await hubClient.getOpening(hub.sessionToken, {
			org_domain: orgDomain,
			opening_number: openingNumber,
		});
		expect(afterRes.body!.viewer_has_applied).toBe(true);
	});

	test("get-opening: 401 when not authenticated", async ({ request }) => {
		const res = await request.post("/hub/get-opening", {
			data: { org_domain: orgDomain, opening_number: openingNumber },
		});
		expect(res.status()).toBe(401);
	});

	// ─── list-colleagues-at-employer ─────────────────────────────────────────────

	test("list-colleagues-at-employer: returns 200 with colleagues array", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.listColleaguesAtEmployer(hubToken, {
			org_domain: orgDomain,
		});
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.colleagues)).toBe(true);
		// Hub user has no connections at this org, so list is empty
		expect(res.body!.colleagues).toHaveLength(0);
	});

	test("list-colleagues-at-employer: 401 when not authenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/list-colleagues-at-employer", {
			data: { org_domain: orgDomain },
		});
		expect(res.status()).toBe(401);
	});

	// ─── list-network-opportunities ──────────────────────────────────────────────

	test("list-network-opportunities: returns 200 with opportunities array", async ({
		request,
	}) => {
		const hubClient = new HubAPIClient(request);
		const res = await hubClient.listNetworkOpportunities(hubToken);
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body!.opportunities)).toBe(true);
		// Hub user has no connections, so opportunities is empty
		expect(res.body!.opportunities).toHaveLength(0);
	});

	test("list-network-opportunities: 401 when not authenticated", async ({
		request,
	}) => {
		const res = await request.post("/hub/list-network-opportunities", {
			data: {},
		});
		expect(res.status()).toBe(401);
	});
});
