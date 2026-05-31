/**
 * Interview notification email tests.
 *
 * Verifies that every interview lifecycle mutation enqueues the right
 * notification emails to the right recipients:
 *  - schedule-interview  → candidate (hub_interview_scheduled) + each interviewer
 *                          (org_interview_scheduled_for_interviewer)
 *  - add-interviewer     → the newly added interviewer
 *  - update-interview    → candidate (hub_interview_updated) + every interviewer
 *                          (org_interview_updated_for_interviewer)
 *  - remove-interviewer  → the removed interviewer (org_interviewer_removed)
 *  - cancel-interview    → candidate (hub_interview_cancelled) + every interviewer
 *                          (org_interview_cancelled_for_interviewer)
 *
 * These templates existed in the schema but were never sent before; this file
 * is the regression guard for that bug.
 */

import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	createTestHubUserDirect,
	generateTestOrgEmail,
	generateTestEmail,
	generateOrgUserEmail,
	deleteTestGlobalOrgDomain,
	deleteTestHubUser,
	createTestOpeningDirect,
	createTestApplicationDirect,
} from "../../../lib/db";
import {
	getTfaCodeFromEmail,
	waitForEmail,
	deleteEmailsFor,
} from "../../../lib/mailpit";
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

function futureSlot(daysAhead: number): { start: string; end: string } {
	const base = Date.now() + daysAhead * 24 * 60 * 60 * 1000;
	return {
		start: new Date(base).toISOString().replace(/\.\d+Z$/, "Z"),
		end: new Date(base + 3600000).toISOString().replace(/\.\d+Z$/, "Z"),
	};
}

test.describe("Interview Notification Emails", () => {
	test.describe.configure({ mode: "serial" });

	const { email: adminEmail, domain: orgDomain } =
		generateTestOrgEmail("iv-notif");
	const ivEmail1 = generateOrgUserEmail("iv-notif-u1", orgDomain);
	const ivEmail2 = generateOrgUserEmail("iv-notif-u2", orgDomain);
	const hubEmail = generateTestEmail("iv-notif-hub");

	let adminToken: string;
	let orgId: string;
	let orgUserId: string;
	let ivUserId2: string;
	let hubGlobalId: string;
	let candidacyId: string;

	test.beforeAll(async ({ request }) => {
		const orgApi = new OrgAPIClient(request);

		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD
		);
		orgId = adminResult.orgId;
		orgUserId = adminResult.orgUserId;
		adminToken = await loginOrgUser(orgApi, adminEmail, orgDomain);

		await createTestOrgUserDirect(ivEmail1, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		const iv2 = await createTestOrgUserDirect(ivEmail2, TEST_PASSWORD, "ind1", {
			orgId,
			domain: orgDomain,
		});
		ivUserId2 = iv2.orgUserId;

		const hubResult = await createTestHubUserDirect(
			hubEmail,
			TEST_PASSWORD,
			"ivnotifhub"
		);
		hubGlobalId = hubResult.hubUserGlobalId;

		const opening = await createTestOpeningDirect(
			orgId,
			orgUserId,
			"Interview Notification Opening"
		);

		const appId = await createTestApplicationDirect(
			orgId,
			orgDomain,
			opening.openingId,
			opening.openingNumber,
			hubGlobalId,
			hubResult.handle,
			"IV Notification Candidate"
		);
		const sr = await orgApi.shortlistApplication(adminToken, {
			application_id: appId,
		});
		expect(sr.status).toBe(200);
		candidacyId = sr.body.candidacy_id;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await deleteTestGlobalOrgDomain(orgDomain);
	});

	test("schedule notifies candidate and the initial interviewer panel", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		await deleteEmailsFor(hubEmail);
		await deleteEmailsFor(ivEmail1);

		const slot = futureSlot(7);
		const res = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: slot.start,
			ends_at: slot.end,
			interviewer_email_addresses: [ivEmail1],
		});
		expect(res.status).toBe(201);

		// Candidate gets the scheduled email.
		const candEmail = await waitForEmail(hubEmail, {}, /Interview scheduled/i);
		expect(candEmail).toBeDefined();

		// Interviewer gets the "added to panel" email.
		const ivMail = await waitForEmail(
			ivEmail1,
			{},
			/added to an interview panel/i
		);
		expect(ivMail).toBeDefined();
	});

	test("add-interviewer notifies the newly added interviewer", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		await deleteEmailsFor(ivEmail1);
		await deleteEmailsFor(ivEmail2);

		const slot = futureSlot(8);
		const sched = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "in_person",
			starts_at: slot.start,
			ends_at: slot.end,
			interviewer_email_addresses: [ivEmail1],
		});
		expect(sched.status).toBe(201);
		const interviewId = sched.body!.interview_id;

		const addRes = await api.addInterviewer(adminToken, {
			interview_id: interviewId,
			org_user_email_address: ivEmail2,
		});
		expect(addRes.status).toBe(200);

		const ivMail = await waitForEmail(
			ivEmail2,
			{},
			/added to an interview panel/i
		);
		expect(ivMail).toBeDefined();
	});

	test("update notifies candidate and all interviewers of the reschedule", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		const slot = futureSlot(9);
		const sched = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: slot.start,
			ends_at: slot.end,
			interviewer_email_addresses: [ivEmail1, ivEmail2],
		});
		expect(sched.status).toBe(201);
		const interviewId = sched.body!.interview_id;

		await deleteEmailsFor(hubEmail);
		await deleteEmailsFor(ivEmail1);
		await deleteEmailsFor(ivEmail2);

		const newSlot = futureSlot(15);
		const updateRes = await api.updateInterview(adminToken, {
			interview_id: interviewId,
			starts_at: newSlot.start,
			ends_at: newSlot.end,
		});
		expect(updateRes.status).toBe(200);

		const candEmail = await waitForEmail(
			hubEmail,
			{},
			/Interview rescheduled/i
		);
		expect(candEmail).toBeDefined();

		for (const ivEmail of [ivEmail1, ivEmail2]) {
			const ivMail = await waitForEmail(ivEmail, {}, /rescheduled/i);
			expect(ivMail).toBeDefined();
		}
	});

	test("remove-interviewer notifies the removed interviewer", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		const slot = futureSlot(10);
		const sched = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: slot.start,
			ends_at: slot.end,
			interviewer_email_addresses: [ivEmail1, ivEmail2],
		});
		expect(sched.status).toBe(201);
		const interviewId = sched.body!.interview_id;

		await deleteEmailsFor(ivEmail2);

		const removeRes = await api.removeInterviewer(adminToken, {
			interview_id: interviewId,
			org_user_id: ivUserId2,
		});
		expect(removeRes.status).toBe(200);

		const ivMail = await waitForEmail(
			ivEmail2,
			{},
			/removed from an interview panel/i
		);
		expect(ivMail).toBeDefined();
	});

	test("cancel notifies candidate and all interviewers", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);

		const slot = futureSlot(11);
		const sched = await api.scheduleInterview(adminToken, {
			candidacy_id: candidacyId,
			interview_type: "video",
			starts_at: slot.start,
			ends_at: slot.end,
			interviewer_email_addresses: [ivEmail1],
		});
		expect(sched.status).toBe(201);
		const interviewId = sched.body!.interview_id;

		await deleteEmailsFor(hubEmail);
		await deleteEmailsFor(ivEmail1);

		const cancelRes = await api.cancelInterview(adminToken, {
			interview_id: interviewId,
		});
		expect(cancelRes.status).toBe(200);

		const candEmail = await waitForEmail(hubEmail, {}, /Interview cancelled/i);
		expect(candEmail).toBeDefined();

		const ivMail = await waitForEmail(ivEmail1, {}, /cancelled/i);
		expect(ivMail).toBeDefined();
	});
});
