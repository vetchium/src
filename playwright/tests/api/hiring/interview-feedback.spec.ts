/**
 * Exhaustive tests for the redesigned interview-feedback state machine:
 *
 * - POST /org/save-interview-feedback     (private draft; lenient validation)
 * - POST /org/submit-interview-feedback   (submit/edit; no longer auto-completes)
 * - POST /org/get-my-interview-feedback   (caller's own draft|submitted, for prefill)
 * - POST /org/complete-interview          (ends the interview, decoupled from feedback)
 *
 * Covers every documented return code (200/400/401/403/404/422), the draft vs
 * submitted lifecycle, draft privacy between panel members, edit semantics
 * (updated_at advances, submitted_at preserved), audit logging, and the fact that
 * feedback submission and interview completion are independent.
 */

import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	createTestHubUserDirect,
	assignRoleToOrgUser,
	generateTestOrgEmail,
	generateTestEmail,
	generateOrgUserEmail,
	deleteTestGlobalOrgDomain,
	deleteTestHubUser,
	createTestOpeningDirect,
	createTestApplicationDirect,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";

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

function futureTimes(daysAhead: number): {
	starts_at: string;
	ends_at: string;
} {
	const base = Date.now() + daysAhead * 24 * 60 * 60 * 1000;
	const starts_at = new Date(base).toISOString().replace(/\.\d+Z$/, "Z");
	const ends_at = new Date(base + 3600000)
		.toISOString()
		.replace(/\.\d+Z$/, "Z");
	return { starts_at, ends_at };
}

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

test.describe("Interview Feedback — draft / submit / complete", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("iv-fb-admin");
	const managerEmail = generateOrgUserEmail("iv-fb-mgr", orgDomain);
	const iv1Email = generateOrgUserEmail("iv-fb-ivr1", orgDomain);
	const iv2Email = generateOrgUserEmail("iv-fb-ivr2", orgDomain);
	const hubEmail = generateTestEmail("iv-fb-hub");

	let adminToken: string;
	let managerToken: string;
	let iv1Token: string;
	let iv2Token: string;

	let orgId: string;
	let adminUserId: string;
	let hubGlobalId: string;
	let hubHandle: string;
	let candidacyId: string;

	// Schedule a fresh interview (so each test is independent) with the given
	// panel emails and return its id. Uses the superadmin token.
	let dayCounter = 5;
	async function scheduleFresh(
		api: OrgAPIClient,
		panel: string[]
	): Promise<string> {
		const { starts_at, ends_at } = futureTimes(dayCounter++);
		const res = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at,
			ends_at,
			interviewer_email_addresses: panel,
		});
		expect(res.status).toBe(201);
		return res.body!.interview_id;
	}

	const VALID = {
		decision: "yes" as const,
		positives: "Clear communicator with strong fundamentals.",
		negatives: "Limited exposure to large-scale systems.",
		overall_assessment: "Solid hire; recommend advancing.",
	};

	test.beforeAll(async ({ request }) => {
		const api = new OrgAPIClient(request);

		const admin = await createTestOrgAdminDirect(adminEmail, TEST_PASSWORD);
		orgId = admin.orgId;
		adminUserId = admin.orgUserId;
		adminToken = await loginOrgUser(api, adminEmail, orgDomain);

		const mgr = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{
				orgId,
				domain: orgDomain,
			}
		);
		await assignRoleToOrgUser(mgr.orgUserId, "org:manage_candidacies");
		managerToken = await loginOrgUser(api, managerEmail, orgDomain);

		await createTestOrgUserDirect(iv1Email, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		iv1Token = await loginOrgUser(api, iv1Email, orgDomain);

		await createTestOrgUserDirect(iv2Email, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		iv2Token = await loginOrgUser(api, iv2Email, orgDomain);

		const hub = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"ivfbhub"
		);
		hubGlobalId = hub.hubUserGlobalId;
		hubHandle = hub.handle;

		const opening = await createTestOpeningDirect(
			orgId,
			adminUserId,
			"Feedback Lifecycle Opening"
		);
		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			opening.openingId,
			opening.openingNumber,
			hubGlobalId,
			hubHandle,
			"Feedback Lifecycle Candidate"
		);
		const sr = await api.shortlistApplication(adminToken, {
			application_id: appId,
		});
		expect(sr.status).toBe(200);
		candidacyId = sr.body.candidacy_id;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	// ─── save-interview-feedback (draft) ──────────────────────────────────────────

	test("save draft: 200; draft is private and not in the team's get-interview", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);

		const res = await api.saveInterviewFeedback(iv1Token, {
			interview_id: interviewId,
			...VALID,
		});
		expect(res.status).toBe(200);

		// The author can read their own draft back.
		const mine = await api.getMyInterviewFeedback(iv1Token, {
			interview_id: interviewId,
		});
		expect(mine.status).toBe(200);
		expect(mine.body!.state).toBe("draft");
		expect(mine.body!.decision).toBe("yes");
		expect(mine.body!.submitted_at).toBeUndefined();
		expect(typeof mine.body!.updated_at).toBe("string");

		// The hiring team's view does NOT expose drafts.
		const team = await api.getInterview(managerToken, {
			interview_id: interviewId,
		});
		expect(team.status).toBe(200);
		expect(team.body!.feedback.length).toBe(0);
		const ivEntry = team.body!.interviewers.find(
			(i: { feedback_submitted: boolean }) => i.feedback_submitted
		);
		expect(ivEntry).toBeUndefined();

		// Audit log for the draft save.
		const audit = await api.listAuditLogs(adminToken, {
			event_types: ["org.save_interview_feedback_draft"],
		});
		expect(
			audit.body!.audit_logs.some(
				(e: { event_type: string }) =>
					e.event_type === "org.save_interview_feedback_draft"
			)
		).toBe(true);
	});

	test("save draft: lenient validation allows empty positives/negatives → 200", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		const res = await api.saveInterviewFeedback(iv1Token, {
			interview_id: interviewId,
			decision: "neutral",
			positives: "",
			negatives: "",
			overall_assessment: "",
		});
		expect(res.status).toBe(200);
	});

	test("save draft: invalid decision → 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		const res = await request.post("/org/save-interview-feedback", {
			headers: { Authorization: `Bearer ${iv1Token}` },
			data: {
				interview_id: interviewId,
				decision: "maybe",
				positives: "x",
				negatives: "x",
				overall_assessment: "x",
			},
		});
		expect(res.status()).toBe(400);
	});

	test("save draft: non-panel user (manager) → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		const res = await api.saveInterviewFeedback(managerToken, {
			interview_id: interviewId,
			...VALID,
		});
		expect(res.status).toBe(403);
	});

	test("save draft: nonexistent interview → 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.saveInterviewFeedback(iv1Token, {
			interview_id: NONEXISTENT_ID,
			...VALID,
		});
		expect(res.status).toBe(404);
	});

	test("save draft: cancelled interview → 422", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		expect(
			(await api.cancelInterview(adminToken, { interview_id: interviewId }))
				.status
		).toBe(200);
		const res = await api.saveInterviewFeedback(iv1Token, {
			interview_id: interviewId,
			...VALID,
		});
		expect(res.status).toBe(422);
	});

	test("save draft: unauthenticated → 401", async ({ request }) => {
		const res = await request.post("/org/save-interview-feedback", {
			data: { interview_id: NONEXISTENT_ID, ...VALID },
		});
		expect(res.status()).toBe(401);
	});

	// ─── submit-interview-feedback (submit + edit, no auto-complete) ───────────────

	test("submit: 200; visible to team; interview stays scheduled; get-my shows submitted", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);

		const res = await api.submitInterviewFeedback(iv1Token, {
			interview_id: interviewId,
			...VALID,
		});
		expect(res.status).toBe(200);

		const team = await api.getInterview(managerToken, {
			interview_id: interviewId,
		});
		expect(team.status).toBe(200);
		expect(team.body!.state).toBe("scheduled"); // decoupled from completion
		expect(team.body!.feedback.length).toBe(1);
		expect(team.body!.feedback[0].decision).toBe("yes");
		expect(typeof team.body!.feedback[0].submitted_at).toBe("string");
		expect(typeof team.body!.feedback[0].updated_at).toBe("string");

		const mine = await api.getMyInterviewFeedback(iv1Token, {
			interview_id: interviewId,
		});
		expect(mine.status).toBe(200);
		expect(mine.body!.state).toBe("submitted");
		expect(typeof mine.body!.submitted_at).toBe("string");
	});

	test("submit then re-submit: edit changes decision; submitted_at preserved, updated_at advances", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);

		expect(
			(
				await api.submitInterviewFeedback(iv1Token, {
					interview_id: interviewId,
					...VALID,
				})
			).status
		).toBe(200);
		const first = await api.getMyInterviewFeedback(iv1Token, {
			interview_id: interviewId,
		});
		expect(first.body!.state).toBe("submitted");
		const firstSubmittedAt = first.body!.submitted_at;
		const firstUpdatedAt = first.body!.updated_at;

		// Ensure a measurable clock tick between writes.
		await new Promise((r) => setTimeout(r, 1100));

		const edit = await api.submitInterviewFeedback(iv1Token, {
			interview_id: interviewId,
			...VALID,
			decision: "strong_no",
			overall_assessment: "Changed my mind after reviewing the take-home.",
		});
		expect(edit.status).toBe(200);

		const second = await api.getMyInterviewFeedback(iv1Token, {
			interview_id: interviewId,
		});
		expect(second.body!.decision).toBe("strong_no");
		expect(second.body!.submitted_at).toBe(firstSubmittedAt); // fixed on first submit
		expect(new Date(second.body!.updated_at).getTime()).toBeGreaterThan(
			new Date(firstUpdatedAt).getTime()
		);

		// The team sees the edited decision.
		const team = await api.getInterview(managerToken, {
			interview_id: interviewId,
		});
		expect(team.body!.feedback[0].decision).toBe("strong_no");
	});

	test("save draft after submit does not un-submit (stays submitted)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		expect(
			(
				await api.submitInterviewFeedback(iv1Token, {
					interview_id: interviewId,
					...VALID,
				})
			).status
		).toBe(200);
		expect(
			(
				await api.saveInterviewFeedback(iv1Token, {
					interview_id: interviewId,
					...VALID,
					overall_assessment: "tweaking wording",
				})
			).status
		).toBe(200);
		const mine = await api.getMyInterviewFeedback(iv1Token, {
			interview_id: interviewId,
		});
		expect(mine.body!.state).toBe("submitted");
	});

	test("submit: strict validation — empty positives → 400", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		const res = await api.submitInterviewFeedback(iv1Token, {
			interview_id: interviewId,
			decision: "yes",
			positives: "",
			negatives: "ok",
			overall_assessment: "ok",
		});
		expect(res.status).toBe(400);
	});

	test("submit: non-panel user (manager) → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		const res = await api.submitInterviewFeedback(managerToken, {
			interview_id: interviewId,
			...VALID,
		});
		expect(res.status).toBe(403);
	});

	test("submit: nonexistent interview → 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.submitInterviewFeedback(iv1Token, {
			interview_id: NONEXISTENT_ID,
			...VALID,
		});
		expect(res.status).toBe(404);
	});

	test("submit: cancelled interview → 422", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		expect(
			(await api.cancelInterview(adminToken, { interview_id: interviewId }))
				.status
		).toBe(200);
		const res = await api.submitInterviewFeedback(iv1Token, {
			interview_id: interviewId,
			...VALID,
		});
		expect(res.status).toBe(422);
	});

	test("submit: unauthenticated → 401", async ({ request }) => {
		const res = await request.post("/org/submit-interview-feedback", {
			data: { interview_id: NONEXISTENT_ID, ...VALID },
		});
		expect(res.status()).toBe(401);
	});

	// ─── draft privacy between panel members ──────────────────────────────────────

	test("draft privacy: interviewer B cannot see interviewer A's draft", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email, iv2Email]);

		// A saves a draft.
		expect(
			(
				await api.saveInterviewFeedback(iv1Token, {
					interview_id: interviewId,
					...VALID,
				})
			).status
		).toBe(200);

		// B has no feedback of their own yet → 404.
		const bMine = await api.getMyInterviewFeedback(iv2Token, {
			interview_id: interviewId,
		});
		expect(bMine.status).toBe(404);

		// The team view shows no submitted feedback (A's is only a draft).
		const team = await api.getInterview(managerToken, {
			interview_id: interviewId,
		});
		expect(team.body!.feedback.length).toBe(0);
	});

	// ─── get-my-interview-feedback ────────────────────────────────────────────────

	test("get-my-feedback: panel member with no feedback yet → 404", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		const res = await api.getMyInterviewFeedback(iv1Token, {
			interview_id: interviewId,
		});
		expect(res.status).toBe(404);
	});

	test("get-my-feedback: non-panel user (manager) → 403", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		const res = await api.getMyInterviewFeedback(managerToken, {
			interview_id: interviewId,
		});
		expect(res.status).toBe(403);
	});

	test("get-my-feedback: missing interview_id → 400", async ({ request }) => {
		const res = await request.post("/org/get-my-interview-feedback", {
			headers: { Authorization: `Bearer ${iv1Token}` },
			data: {},
		});
		expect(res.status()).toBe(400);
	});

	test("get-my-feedback: unauthenticated → 401", async ({ request }) => {
		const res = await request.post("/org/get-my-interview-feedback", {
			data: { interview_id: NONEXISTENT_ID },
		});
		expect(res.status()).toBe(401);
	});

	// ─── complete-interview (decoupled) ───────────────────────────────────────────

	test("complete: panel interviewer ends a scheduled interview → 200 + audit", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);

		const res = await api.completeInterview(iv1Token, {
			interview_id: interviewId,
		});
		expect(res.status).toBe(200);

		const team = await api.getInterview(managerToken, {
			interview_id: interviewId,
		});
		expect(team.body!.state).toBe("completed");

		const audit = await api.listAuditLogs(adminToken, {
			event_types: ["org.complete_interview"],
		});
		expect(
			audit.body!.audit_logs.some(
				(e: { event_type: string }) => e.event_type === "org.complete_interview"
			)
		).toBe(true);
	});

	test("complete: feedback can still be submitted after completion", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		expect(
			(await api.completeInterview(iv1Token, { interview_id: interviewId }))
				.status
		).toBe(200);
		// Feedback remains open on a completed interview.
		const res = await api.submitInterviewFeedback(iv1Token, {
			interview_id: interviewId,
			...VALID,
		});
		expect(res.status).toBe(200);
		const team = await api.getInterview(managerToken, {
			interview_id: interviewId,
		});
		expect(team.body!.state).toBe("completed");
		expect(team.body!.feedback.length).toBe(1);
	});

	test("complete: already-completed interview → 422", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		expect(
			(await api.completeInterview(iv1Token, { interview_id: interviewId }))
				.status
		).toBe(200);
		const res = await api.completeInterview(iv1Token, {
			interview_id: interviewId,
		});
		expect(res.status).toBe(422);
	});

	test("complete: cancelled interview → 422", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		expect(
			(await api.cancelInterview(adminToken, { interview_id: interviewId }))
				.status
		).toBe(200);
		const res = await api.completeInterview(iv1Token, {
			interview_id: interviewId,
		});
		expect(res.status).toBe(422);
	});

	test("complete: non-panel user (manager) → 403", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const interviewId = await scheduleFresh(api, [iv1Email]);
		const res = await api.completeInterview(managerToken, {
			interview_id: interviewId,
		});
		expect(res.status).toBe(403);
	});

	test("complete: nonexistent interview → 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		const res = await api.completeInterview(iv1Token, {
			interview_id: NONEXISTENT_ID,
		});
		expect(res.status).toBe(404);
	});

	test("complete: unauthenticated → 401", async ({ request }) => {
		const res = await request.post("/org/complete-interview", {
			data: { interview_id: NONEXISTENT_ID },
		});
		expect(res.status()).toBe(401);
	});
});
