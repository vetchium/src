import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestHubUserDirect,
	createTestOrgAdminDirect,
	deleteTestHubUser,
	generateTestEmail,
	generateTestOrgEmail,
	deleteTestGlobalOrgDomain,
	createTestWorkEmailStintDirect,
	createTestHubConnectionDirect,
	createTestOpeningDirect,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	NominateColleagueRequest,
	AcceptReferralRequest,
	DeclineReferralRequest,
	ListReferralsRequest,
} from "vetchium-specs/hub/referrals";

test.describe("T3 Referrals", () => {
	test.describe.configure({ mode: "serial" });

	const referrerEmail = generateTestEmail("ref-referrer");
	const candidateEmail = generateTestEmail("ref-candidate");
	const { email: orgEmail, domain: orgDomain } =
		generateTestOrgEmail("referral-org");

	let referrerToken: string;
	let candidateToken: string;
	let referrerGlobalId: string;
	let referrerHandle: string;
	let candidateGlobalId: string;
	let candidateHandle: string;
	let orgId: string;
	let orgUserId: string;
	let openingNumber: number;
	let nominationId: string;

	test.beforeAll(async () => {
		const referrerResult = await createTestHubUserDirect(
			referrerEmail,
			TEST_PASSWORD,
			"ref-referrer"
		);
		referrerToken = referrerResult.sessionToken;
		referrerGlobalId = referrerResult.hubUserGlobalId;
		referrerHandle = referrerResult.handle;

		const candidateResult = await createTestHubUserDirect(
			candidateEmail,
			TEST_PASSWORD,
			"ref-candidate"
		);
		candidateToken = candidateResult.sessionToken;
		candidateGlobalId = candidateResult.hubUserGlobalId;
		candidateHandle = candidateResult.handle;

		// Create org
		const orgResult = await createTestOrgAdminDirect(orgEmail, TEST_PASSWORD);
		orgId = orgResult.orgId;
		orgUserId = orgResult.orgUserId;

		// Give referrer an active work email stint at the org's domain (required for nominating)
		await createTestWorkEmailStintDirect(
			referrerGlobalId,
			`${referrerHandle}@${orgDomain}`,
			"active"
		);

		// Create a shared domain stint for candidate and referrer (required for connection endorsement context)
		const sharedDomain = "shared-workplace.example.com";
		await createTestWorkEmailStintDirect(
			referrerGlobalId,
			`${referrerHandle}@${sharedDomain}`,
			"active"
		);
		await createTestWorkEmailStintDirect(
			candidateGlobalId,
			`${candidateHandle}@${sharedDomain}`,
			"active"
		);

		// Connect referrer and candidate
		await createTestHubConnectionDirect(
			referrerGlobalId,
			referrerHandle,
			candidateGlobalId,
			candidateHandle
		);

		// Create a published opening
		const openingResult = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Staff Engineer"
		);
		openingNumber = openingResult.openingNumber;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(referrerEmail);
		await deleteTestHubUser(candidateEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── list-referrals-received ─────────────────────────────────────────────

	test("list-referrals-received returns 200 for candidate", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: ListReferralsRequest = {};
		const res = await api.listReferralsReceived(candidateToken, req);
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty("referrals");
	});

	test("list-referrals-received returns 401 unauthenticated", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const res = await api.listReferralsReceived("bad-token", {});
		expect(res.status).toBe(401);
	});

	// ─── list-referrals-made ─────────────────────────────────────────────────

	test("list-referrals-made returns 200 for referrer", async ({ request }) => {
		const api = new HubAPIClient(request);
		const res = await api.listReferralsMade(referrerToken, {});
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty("referrals");
	});

	test("list-referrals-made returns 401 unauthenticated", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const res = await api.listReferralsMade("bad-token", {});
		expect(res.status).toBe(401);
	});

	// ─── nominate-colleague-for-role ─────────────────────────────────────────

	test("nominate-colleague 400 for non-connection", async ({ request }) => {
		const api = new HubAPIClient(request);
		const req: NominateColleagueRequest = {
			candidate_handle: "nonexistent-handle-xyz",
			org_domain: orgDomain,
			opening_number: openingNumber,
			statement_text: "A".repeat(100),
		};
		const res = await api.nominateColleagueForRole(referrerToken, req);
		expect(res.status).toBe(400);
	});

	test("nominate-colleague 400 for self-nomination", async ({ request }) => {
		const api = new HubAPIClient(request);
		const req: NominateColleagueRequest = {
			candidate_handle: referrerHandle,
			org_domain: orgDomain,
			opening_number: openingNumber,
			statement_text: "A".repeat(100),
		};
		const res = await api.nominateColleagueForRole(referrerToken, req);
		expect(res.status).toBe(400);
	});

	test("nominate-colleague 400 for statement_text < 100 chars", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const req: NominateColleagueRequest = {
			candidate_handle: candidateHandle,
			org_domain: orgDomain,
			opening_number: openingNumber,
			statement_text: "Too short",
		};
		const res = await api.nominateColleagueForRole(referrerToken, req);
		expect(res.status).toBe(400);
	});

	test("nominate-colleague 200 happy path", async ({ request }) => {
		const api = new HubAPIClient(request);
		const req: NominateColleagueRequest = {
			candidate_handle: candidateHandle,
			org_domain: orgDomain,
			opening_number: openingNumber,
			statement_text: "A".repeat(100),
		};
		const res = await api.nominateColleagueForRole(referrerToken, req);
		expect(res.status).toBe(201);
		expect(res.body).toHaveProperty("nomination_id");
		nominationId = res.body!.nomination_id;

		// Audit log assertion
		const auditRes = await api.listAuditLogs(referrerToken, {
			event_types: ["hub.nominate_colleague"],
		});
		expect(auditRes.status).toBe(200);
		const auditEntry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string }) => e.event_type === "hub.nominate_colleague"
		);
		expect(auditEntry).toBeDefined();
	});

	test("nominate-colleague 401 unauthenticated", async ({ request }) => {
		const api = new HubAPIClient(request);
		const req: NominateColleagueRequest = {
			candidate_handle: candidateHandle,
			org_domain: orgDomain,
			opening_number: openingNumber,
			statement_text: "A".repeat(100),
		};
		const res = await api.nominateColleagueForRole("bad-token", req);
		expect(res.status).toBe(401);
	});

	// ─── decline-referral ────────────────────────────────────────────────────

	test("decline-referral 401 unauthenticated", async ({ request }) => {
		const api = new HubAPIClient(request);
		// nominationId was set by the nominate-colleague 200 happy path test above
		const req: DeclineReferralRequest = { nomination_id: nominationId };
		const res = await api.declineReferral("bad-token", req);
		expect(res.status).toBe(401);
	});

	test("decline-referral 200 for candidate on received nomination", async ({
		request,
	}) => {
		if (!nominationId) {
			test.skip();
			return;
		}
		const api = new HubAPIClient(request);
		const req: DeclineReferralRequest = { nomination_id: nominationId };
		const res = await api.declineReferral(candidateToken, req);
		expect(res.status).toBe(200);

		// Audit log written even though the decline is silent to the referrer
		const auditRes = await api.listAuditLogs(candidateToken, {
			event_types: ["hub.decline_referral"],
		});
		expect(auditRes.status).toBe(200);
		const entry = auditRes.body?.audit_logs?.find(
			(e: { event_type: string; event_data: Record<string, unknown> }) =>
				e.event_type === "hub.decline_referral" &&
				e.event_data?.nomination_id === nominationId
		);
		expect(entry).toBeDefined();
	});

	// ─── accept-referral ─────────────────────────────────────────────────────

	test("accept-referral 401 unauthenticated", async ({ request }) => {
		const api = new HubAPIClient(request);
		// nominationId was created above; auth fires before DB lookup so real ID is fine
		const req: AcceptReferralRequest = { nomination_id: nominationId };
		const res = await api.acceptReferral("bad-token", req);
		expect(res.status).toBe(401);
	});

	test("accept-referral 404 when referrer tries to accept candidate's nomination", async ({
		request,
	}) => {
		// The nomination was sent TO the candidate. The referrer (sender) is not
		// the intended recipient, so accept returns 404.
		const api = new HubAPIClient(request);
		const req: AcceptReferralRequest = { nomination_id: nominationId };
		const res = await api.acceptReferral(referrerToken, req);
		expect(res.status).toBe(404);
	});

	test("accept-referral 200 returns the org domain (not the org name) for apply prefill", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		// Fresh opening so a new pending nomination can be created (the prior one
		// for `openingNumber` was declined above).
		const opening2 = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Principal Engineer"
		);
		const statement = "B".repeat(120);
		const nominate = await api.nominateColleagueForRole(referrerToken, {
			candidate_handle: candidateHandle,
			org_domain: orgDomain,
			opening_number: opening2.openingNumber,
			statement_text: statement,
		});
		expect(nominate.status).toBe(201);

		const accept = await api.acceptReferral(candidateToken, {
			nomination_id: nominate.body!.nomination_id,
		});
		expect(accept.status).toBe(200);
		// Regression: the handler previously returned the org NAME here.
		expect(accept.body!.org_domain).toBe(orgDomain);
		expect(accept.body!.opening_number).toBe(opening2.openingNumber);
		expect(accept.body!.prefill_statement_for_endorsement).toBe(statement);
	});

	// ─── keyset pagination ───────────────────────────────────────────────────
	// Regression: list-referrals-received / list-referrals-made previously
	// ignored pagination_key and never returned next_pagination_key.

	const paginationNominationIds: string[] = [];

	test("create several nominations for pagination coverage", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		// Three fresh openings → three new pending nominations to the candidate.
		for (let i = 0; i < 3; i++) {
			const opening = await createTestOpeningDirect(
				orgId,
				orgUserId,
				`Pagination Role ${i}`
			);
			const res = await api.nominateColleagueForRole(referrerToken, {
				candidate_handle: candidateHandle,
				org_domain: orgDomain,
				opening_number: opening.openingNumber,
				statement_text: "P".repeat(100),
			});
			expect(res.status).toBe(201);
			paginationNominationIds.push(res.body!.nomination_id);
		}
	});

	test("list-referrals-made paginates with limit + next_pagination_key", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		const page1 = await api.listReferralsMade(referrerToken, { limit: 2 });
		expect(page1.status).toBe(200);
		expect(page1.body!.referrals.length).toBe(2);
		expect(page1.body!.next_pagination_key).toBeTruthy();

		// Walk every page; collect ids and assert no duplicates across pages.
		const seen = new Set<string>();
		page1.body!.referrals.forEach((r) => seen.add(r.nomination_id));

		let key = page1.body!.next_pagination_key;
		let guard = 0;
		while (key && guard < 20) {
			guard++;
			const next = await api.listReferralsMade(referrerToken, {
				limit: 2,
				pagination_key: key,
			});
			expect(next.status).toBe(200);
			next.body!.referrals.forEach((r) => {
				expect(seen.has(r.nomination_id)).toBe(false);
				seen.add(r.nomination_id);
			});
			key = next.body!.next_pagination_key;
		}

		// Every nomination created in this run must surface across the pages.
		for (const id of paginationNominationIds) {
			expect(seen.has(id)).toBe(true);
		}
	});

	test("list-referrals-received paginates with limit + next_pagination_key", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);

		const page1 = await api.listReferralsReceived(candidateToken, { limit: 2 });
		expect(page1.status).toBe(200);
		expect(page1.body!.referrals.length).toBe(2);
		expect(page1.body!.next_pagination_key).toBeTruthy();

		const seen = new Set<string>();
		page1.body!.referrals.forEach((r) => seen.add(r.nomination_id));

		let key = page1.body!.next_pagination_key;
		let guard = 0;
		while (key && guard < 20) {
			guard++;
			const next = await api.listReferralsReceived(candidateToken, {
				limit: 2,
				pagination_key: key,
			});
			expect(next.status).toBe(200);
			next.body!.referrals.forEach((r) => {
				expect(seen.has(r.nomination_id)).toBe(false);
				seen.add(r.nomination_id);
			});
			key = next.body!.next_pagination_key;
		}

		// The pending nominations created above are received by the candidate.
		for (const id of paginationNominationIds) {
			expect(seen.has(id)).toBe(true);
		}
	});

	test("list-referrals-made last page omits next_pagination_key", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		// A page large enough to hold every nomination must not advertise more.
		const res = await api.listReferralsMade(referrerToken, { limit: 100 });
		expect(res.status).toBe(200);
		expect(res.body!.next_pagination_key).toBeFalsy();
	});
});
