/**
 * Tests for Hub Work Email endpoints:
 *   POST /hub/add-work-email
 *   POST /hub/verify-work-email
 *   POST /hub/resend-work-email-code
 *   POST /hub/reverify-work-email
 *   POST /hub/remove-work-email
 *   POST /hub/list-my-work-emails
 *   POST /hub/get-my-work-email
 *   POST /hub/list-public-employer-stints
 */
import { test, expect } from "@playwright/test";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	deleteTestHubUser,
	generateTestEmail,
	generateTestDomainName,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
	extractSignupTokenFromEmail,
	getHubUserRegionalId,
	addPersonalDomainBlocklistEntry,
	removePersonalDomainBlocklistEntry,
	createTestWorkEmailStintDirect,
	setStintPendingCodeExpiresAt,
	insertReverifyChallengeDirect,
	expireWorkEmailReverifyChallenge,
	setStintEnded,
} from "../../../lib/db";
import {
	waitForEmail,
	getEmailContent,
	deleteEmailsFor,
	getTfaCodeFromEmail,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	RequestSignupRequest,
	CompleteSignupRequest,
	HubLoginRequest,
} from "vetchium-specs/hub/hub-users";

// ============================================================================
// Helper: full signup → login → TFA → session token
// ============================================================================
async function createHubUserAndLogin(
	api: HubAPIClient,
	email: string,
	password: string,
	displayName: string = "Test User"
): Promise<string> {
	const reqSignup: RequestSignupRequest = { email_address: email };
	await api.requestSignup(reqSignup);

	const emailSummary = await waitForEmail(email);
	const emailContent = await getEmailContent(emailSummary.ID);
	const signupToken = extractSignupTokenFromEmail(emailContent);

	const completeReq: CompleteSignupRequest = {
		signup_token: signupToken!,
		password,
		preferred_display_name: displayName,
		home_region: "ind1",
		preferred_language: "en-US",
		resident_country_code: "US",
	};
	await api.completeSignup(completeReq);

	const loginReq: HubLoginRequest = {
		email_address: email,
		password,
	};
	const loginResp = await api.login(loginReq);
	expect(loginResp.status).toBe(200);

	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaResp = await api.verifyTFA({
		tfa_token: loginResp.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	});
	expect(tfaResp.status).toBe(200);
	return tfaResp.body.session_token;
}

// ============================================================================
// Shared approved domain for hub user signups
// ============================================================================
let sharedAdminEmail: string;
let sharedDomain: string;

test.beforeAll(async ({ request }) => {
	sharedAdminEmail = generateTestEmail("we-admin");
	sharedDomain = generateTestDomainName("we");
	await createTestAdminUser(sharedAdminEmail, TEST_PASSWORD);
	await createTestApprovedDomain(sharedDomain, sharedAdminEmail);
});

test.afterAll(async () => {
	await permanentlyDeleteTestApprovedDomain(sharedDomain);
	await deleteTestAdminUser(sharedAdminEmail);
});

// ============================================================================
// POST /hub/add-work-email
// ============================================================================
test.describe("POST /hub/add-work-email", () => {
	test("success — valid corporate email returns 201 with stint_id", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-add-ok@${sharedDomain}`;
		const workEmail = `alice@acme-${Date.now()}.test.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const before = new Date(Date.now() - 2000).toISOString();
			const resp = await api.addWorkEmail(sessionToken, {
				email_address: workEmail,
			});
			expect(resp.status).toBe(201);
			expect(resp.body.stint_id).toBeTruthy();
			expect(resp.body.pending_code_expires_at).toBeTruthy();

			// Audit log written
			const auditResp = await api.listAuditLogs(sessionToken, {
				event_types: ["hub.add_work_email"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			const entry = auditResp.body.audit_logs.find(
				(e) => e.event_type === "hub.add_work_email"
			);
			expect(entry).toBeDefined();
			expect(entry!.event_data).toHaveProperty("domain");
			expect(entry!.event_data).toHaveProperty("email_address_hash");
			expect(JSON.stringify(entry!.event_data)).not.toContain(workEmail);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("personal-domain (gmail.com) returns 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-personal@${sharedDomain}`;
		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const resp = await api.addWorkEmail(sessionToken, {
				email_address: "alice@gmail.com",
			});
			expect(resp.status).toBe(422);

			// No audit log
			const auditResp = await api.listAuditLogs(sessionToken, {
				event_types: ["hub.add_work_email"],
				start_time: new Date(Date.now() - 1000).toISOString(),
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBe(0);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("address held by another HubUser returns 409", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail1 = `we-held1@${sharedDomain}`;
		const hubEmail2 = `we-held2@${sharedDomain}`;
		const workEmail = `shared-${Date.now()}@corp-test-${Date.now()}.example`;

		const sessionToken1 = await createHubUserAndLogin(
			api,
			hubEmail1,
			TEST_PASSWORD
		);
		const sessionToken2 = await createHubUserAndLogin(
			api,
			hubEmail2,
			TEST_PASSWORD
		);

		try {
			// User1 claims first
			const resp1 = await api.addWorkEmail(sessionToken1, {
				email_address: workEmail,
			});
			expect(resp1.status).toBe(201);

			// User2 tries to claim same address → 409
			const resp2 = await api.addWorkEmail(sessionToken2, {
				email_address: workEmail,
			});
			expect(resp2.status).toBe(409);
		} finally {
			await deleteTestHubUser(hubEmail1);
			await deleteTestHubUser(hubEmail2);
			await deleteEmailsFor(hubEmail1);
			await deleteEmailsFor(hubEmail2);
		}
	});

	test("caller already holds in pending returns 409", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-dup-pending@${sharedDomain}`;
		const workEmail = `pending-dup-${Date.now()}@corp-test.example`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const resp1 = await api.addWorkEmail(sessionToken, {
				email_address: workEmail,
			});
			expect(resp1.status).toBe(201);

			const resp2 = await api.addWorkEmail(sessionToken, {
				email_address: workEmail,
			});
			expect(resp2.status).toBe(409);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("validation: empty email returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-val-empty@${sharedDomain}`;
		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const resp = await api.addWorkEmailRaw(sessionToken, {
				email_address: "",
			});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("validation: malformed email returns 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-val-bad@${sharedDomain}`;
		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const resp = await api.addWorkEmailRaw(sessionToken, {
				email_address: "not-an-email",
			});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("unauthenticated returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const resp = await api.addWorkEmailRaw("invalid-token", {
			email_address: "alice@corp.example",
		});
		expect(resp.status).toBe(401);
	});
});

// ============================================================================
// POST /hub/verify-work-email
// ============================================================================
test.describe("POST /hub/verify-work-email", () => {
	test("success — valid code transitions to active", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-verify-ok@${sharedDomain}`;
		const workEmail = `verify-ok-${Date.now()}@acme-verify.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			// Add work email — this sends code to workEmail
			const addResp = await api.addWorkEmail(sessionToken, {
				email_address: workEmail,
			});
			expect(addResp.status).toBe(201);
			const stintId = addResp.body.stint_id;

			// Get the code from the work email inbox
			const codeSummary = await waitForEmail(workEmail);
			const codeContent = await getEmailContent(codeSummary.ID);
			const code = codeContent.Text.match(/\b(\d{6})\b/)?.[1];
			expect(code).toBeTruthy();

			const before = new Date(Date.now() - 2000).toISOString();
			const verifyResp = await api.verifyWorkEmail(sessionToken, {
				stint_id: stintId,
				code: code!,
			});
			expect(verifyResp.status).toBe(200);
			expect(verifyResp.body.status).toBe("active");
			expect(verifyResp.body.first_verified_at).toBeTruthy();
			expect(verifyResp.body.last_verified_at).toBeTruthy();

			// Audit log
			const auditResp = await api.listAuditLogs(sessionToken, {
				event_types: ["hub.verify_work_email"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			const entry = auditResp.body.audit_logs.find(
				(e) => e.event_type === "hub.verify_work_email"
			);
			expect(entry).toBeDefined();
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
			await deleteEmailsFor(workEmail);
		}
	});

	test("wrong code returns 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-verify-bad@${sharedDomain}`;
		const workEmail = `verify-bad-${Date.now()}@acme-bad.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const addResp = await api.addWorkEmail(sessionToken, {
				email_address: workEmail,
			});
			expect(addResp.status).toBe(201);

			const verifyResp = await api.verifyWorkEmail(sessionToken, {
				stint_id: addResp.body.stint_id,
				code: "000000",
			});
			expect(verifyResp.status).toBe(422);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
			await deleteEmailsFor(workEmail);
		}
	});

	test("expired code returns 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-verify-exp@${sharedDomain}`;
		const workEmail = `verify-exp-${Date.now()}@acme-exp.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const addResp = await api.addWorkEmail(sessionToken, {
				email_address: workEmail,
			});
			expect(addResp.status).toBe(201);
			const stintId = addResp.body.stint_id;

			// Expire the code via direct DB update
			await setStintPendingCodeExpiresAt(stintId, new Date(Date.now() - 1000));

			// Get the code (even though it's expired)
			const codeSummary = await waitForEmail(workEmail);
			const codeContent = await getEmailContent(codeSummary.ID);
			const code = codeContent.Text.match(/\b(\d{6})\b/)?.[1] ?? "000000";

			const verifyResp = await api.verifyWorkEmail(sessionToken, {
				stint_id: stintId,
				code,
			});
			expect(verifyResp.status).toBe(422);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
			await deleteEmailsFor(workEmail);
		}
	});

	test("stint owned by someone else returns 404", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail1 = `we-verify-owner1@${sharedDomain}`;
		const hubEmail2 = `we-verify-owner2@${sharedDomain}`;
		const workEmail = `verify-owner-${Date.now()}@acme-owner.corp`;

		const sessionToken1 = await createHubUserAndLogin(
			api,
			hubEmail1,
			TEST_PASSWORD
		);
		const sessionToken2 = await createHubUserAndLogin(
			api,
			hubEmail2,
			TEST_PASSWORD
		);
		try {
			const addResp = await api.addWorkEmail(sessionToken1, {
				email_address: workEmail,
			});
			expect(addResp.status).toBe(201);

			// User2 tries to verify user1's stint
			const verifyResp = await api.verifyWorkEmail(sessionToken2, {
				stint_id: addResp.body.stint_id,
				code: "123456",
			});
			expect(verifyResp.status).toBe(404);
		} finally {
			await deleteTestHubUser(hubEmail1);
			await deleteTestHubUser(hubEmail2);
			await deleteEmailsFor(hubEmail1);
			await deleteEmailsFor(hubEmail2);
			await deleteEmailsFor(workEmail);
		}
	});

	test("unauthenticated returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const resp = await api.verifyWorkEmailRaw("bad-token", {
			stint_id: "00000000-0000-0000-0000-000000000000",
			code: "123456",
		});
		expect(resp.status).toBe(401);
	});
});

// ============================================================================
// POST /hub/resend-work-email-code
// ============================================================================
test.describe("POST /hub/resend-work-email-code", () => {
	test("success — returns 200 with updated stint", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-resend-ok@${sharedDomain}`;
		const workEmail = `resend-ok-${Date.now()}@acme-resend.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const addResp = await api.addWorkEmail(sessionToken, {
				email_address: workEmail,
			});
			expect(addResp.status).toBe(201);
			const stintId = addResp.body.stint_id;

			// Wait a bit to avoid the 60s rate limit (we hack via DB)
			// Instead use a fresh stint that has never been resent
			const before = new Date(Date.now() - 2000).toISOString();
			const resendResp = await api.resendWorkEmailCode(sessionToken, {
				stint_id: stintId,
			});
			expect(resendResp.status).toBe(200);
			expect(resendResp.body.status).toBe("pending_verification");

			// Audit
			const auditResp = await api.listAuditLogs(sessionToken, {
				event_types: ["hub.resend_work_email_code"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			const entry = auditResp.body.audit_logs.find(
				(e) => e.event_type === "hub.resend_work_email_code"
			);
			expect(entry).toBeDefined();
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
			await deleteEmailsFor(workEmail);
		}
	});

	test("within 60s rate limit returns 429", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-resend-rl@${sharedDomain}`;
		const workEmail = `resend-rl-${Date.now()}@acme-rl.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const addResp = await api.addWorkEmail(sessionToken, {
				email_address: workEmail,
			});
			expect(addResp.status).toBe(201);

			// First resend succeeds
			const r1 = await api.resendWorkEmailCode(sessionToken, {
				stint_id: addResp.body.stint_id,
			});
			expect(r1.status).toBe(200);

			// Immediate second resend → 429
			const r2 = await api.resendWorkEmailCode(sessionToken, {
				stint_id: addResp.body.stint_id,
			});
			expect(r2.status).toBe(429);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
			await deleteEmailsFor(workEmail);
		}
	});

	test("stint not in pending_verification returns 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-resend-notpend@${sharedDomain}`;
		const workEmail = `resend-np-${Date.now()}@acme-np.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			// Create a direct active stint
			const stintId = await createTestWorkEmailStintDirect(
				regionalId!,
				workEmail,
				"active"
			);

			const resp = await api.resendWorkEmailCode(sessionToken, {
				stint_id: stintId,
			});
			expect(resp.status).toBe(422);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("unauthenticated returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const resp = await api.resendWorkEmailCodeRaw("bad-token", {
			stint_id: "00000000-0000-0000-0000-000000000000",
		});
		expect(resp.status).toBe(401);
	});
});

// ============================================================================
// POST /hub/reverify-work-email
// ============================================================================
test.describe("POST /hub/reverify-work-email", () => {
	test("success when challenge exists returns 200", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-reverify-ok@${sharedDomain}`;
		const workEmail = `reverify-ok-${Date.now()}@acme-rev.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			// Create active stint directly
			const stintId = await createTestWorkEmailStintDirect(
				regionalId!,
				workEmail,
				"active"
			);

			// Insert a reverify challenge with code "123456"
			await insertReverifyChallengeDirect(stintId);

			const before = new Date(Date.now() - 2000).toISOString();
			const resp = await api.reverifyWorkEmail(sessionToken, {
				stint_id: stintId,
				code: "123456",
			});
			expect(resp.status).toBe(200);
			expect(resp.body.status).toBe("active");

			// Audit
			const auditResp = await api.listAuditLogs(sessionToken, {
				event_types: ["hub.reverify_work_email"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			const entry = auditResp.body.audit_logs.find(
				(e) => e.event_type === "hub.reverify_work_email"
			);
			expect(entry).toBeDefined();
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("no active challenge returns 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-reverify-nochal@${sharedDomain}`;
		const workEmail = `reverify-nc-${Date.now()}@acme-nc.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			const stintId = await createTestWorkEmailStintDirect(
				regionalId!,
				workEmail,
				"active"
			);

			// No challenge inserted — should 422
			const resp = await api.reverifyWorkEmail(sessionToken, {
				stint_id: stintId,
				code: "123456",
			});
			expect(resp.status).toBe(422);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("expired challenge returns 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-reverify-exp@${sharedDomain}`;
		const workEmail = `reverify-exp-${Date.now()}@acme-rexp.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			const stintId = await createTestWorkEmailStintDirect(
				regionalId!,
				workEmail,
				"active"
			);
			await insertReverifyChallengeDirect(stintId);
			await expireWorkEmailReverifyChallenge(stintId);

			const resp = await api.reverifyWorkEmail(sessionToken, {
				stint_id: stintId,
				code: "123456",
			});
			expect(resp.status).toBe(422);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("wrong code returns 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-reverify-bad@${sharedDomain}`;
		const workEmail = `reverify-bad-${Date.now()}@acme-rbad.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			const stintId = await createTestWorkEmailStintDirect(
				regionalId!,
				workEmail,
				"active"
			);
			await insertReverifyChallengeDirect(stintId);

			const resp = await api.reverifyWorkEmail(sessionToken, {
				stint_id: stintId,
				code: "000000", // wrong code (challenge hash is "123456")
			});
			expect(resp.status).toBe(422);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("unauthenticated returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const resp = await api.reverifyWorkEmailRaw("bad-token", {
			stint_id: "00000000-0000-0000-0000-000000000000",
			code: "123456",
		});
		expect(resp.status).toBe(401);
	});
});

// ============================================================================
// POST /hub/remove-work-email
// ============================================================================
test.describe("POST /hub/remove-work-email", () => {
	test("success on pending stint returns 200 with ended_reason=user_removed_pending", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-remove-pend@${sharedDomain}`;
		const workEmail = `remove-pend-${Date.now()}@acme-rm.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const addResp = await api.addWorkEmail(sessionToken, {
				email_address: workEmail,
			});
			expect(addResp.status).toBe(201);

			const before = new Date(Date.now() - 2000).toISOString();
			const removeResp = await api.removeWorkEmail(sessionToken, {
				stint_id: addResp.body.stint_id,
			});
			expect(removeResp.status).toBe(200);
			expect(removeResp.body.status).toBe("ended");
			expect(removeResp.body.ended_reason).toBe("user_removed_pending");

			// Audit
			const auditResp = await api.listAuditLogs(sessionToken, {
				event_types: ["hub.remove_work_email"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(
				auditResp.body.audit_logs.find(
					(e) => e.event_type === "hub.remove_work_email"
				)
			).toBeDefined();
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
			await deleteEmailsFor(workEmail);
		}
	});

	test("success on active stint returns 200 with ended_reason=user_removed", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-remove-act@${sharedDomain}`;
		const workEmail = `remove-act-${Date.now()}@acme-rma.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			const stintId = await createTestWorkEmailStintDirect(
				regionalId!,
				workEmail,
				"active"
			);

			const removeResp = await api.removeWorkEmail(sessionToken, {
				stint_id: stintId,
			});
			expect(removeResp.status).toBe(200);
			expect(removeResp.body.status).toBe("ended");
			expect(removeResp.body.ended_reason).toBe("user_removed");
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("already ended returns 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-remove-ended@${sharedDomain}`;
		const workEmail = `remove-ended-${Date.now()}@acme-rme.corp`;

		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			const stintId = await createTestWorkEmailStintDirect(
				regionalId!,
				workEmail,
				"ended"
			);

			const resp = await api.removeWorkEmail(sessionToken, {
				stint_id: stintId,
			});
			expect(resp.status).toBe(422);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("not found returns 404", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-remove-404@${sharedDomain}`;
		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const resp = await api.removeWorkEmail(sessionToken, {
				stint_id: "00000000-0000-0000-0000-000000000000",
			});
			expect(resp.status).toBe(404);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("unauthenticated returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const resp = await api.removeWorkEmailRaw("bad-token", {
			stint_id: "00000000-0000-0000-0000-000000000000",
		});
		expect(resp.status).toBe(401);
	});
});

// ============================================================================
// POST /hub/list-my-work-emails
// ============================================================================
test.describe("POST /hub/list-my-work-emails", () => {
	test("success returns 200 with list of stints", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-list-ok@${sharedDomain}`;
		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			// Create a couple stints directly
			await createTestWorkEmailStintDirect(
				regionalId!,
				`list-a-${Date.now()}@corp-lst.example`,
				"active"
			);
			await createTestWorkEmailStintDirect(
				regionalId!,
				`list-b-${Date.now()}@corp-lst.example`,
				"ended"
			);

			const resp = await api.listMyWorkEmails(sessionToken, {
				limit: 10,
			});
			expect(resp.status).toBe(200);
			expect(resp.body.work_emails.length).toBeGreaterThanOrEqual(2);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("filter_status=active returns only active rows", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-list-filt@${sharedDomain}`;
		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			await createTestWorkEmailStintDirect(
				regionalId!,
				`filt-a-${Date.now()}@corp-flt.example`,
				"active"
			);
			await createTestWorkEmailStintDirect(
				regionalId!,
				`filt-b-${Date.now()}@corp-flt.example`,
				"ended"
			);

			const resp = await api.listMyWorkEmails(sessionToken, {
				filter_status: ["active"],
				limit: 10,
			});
			expect(resp.status).toBe(200);
			expect(resp.body.work_emails.every((w) => w.status === "active")).toBe(
				true
			);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("unauthenticated returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const resp = await api.listMyWorkEmailsRaw("bad-token", {});
		expect(resp.status).toBe(401);
	});
});

// ============================================================================
// POST /hub/get-my-work-email
// ============================================================================
test.describe("POST /hub/get-my-work-email", () => {
	test("success returns 200 with the stint", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-get-ok@${sharedDomain}`;
		const workEmail = `get-ok-${Date.now()}@corp-get.example`;
		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			const stintId = await createTestWorkEmailStintDirect(
				regionalId!,
				workEmail,
				"active"
			);

			const resp = await api.getMyWorkEmail(sessionToken, {
				stint_id: stintId,
			});
			expect(resp.status).toBe(200);
			expect(resp.body.stint_id).toBe(stintId);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("stint owned by someone else returns 404", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail1 = `we-get-other1@${sharedDomain}`;
		const hubEmail2 = `we-get-other2@${sharedDomain}`;
		const workEmail = `get-other-${Date.now()}@corp-goth.example`;

		const sessionToken1 = await createHubUserAndLogin(
			api,
			hubEmail1,
			TEST_PASSWORD
		);
		const sessionToken2 = await createHubUserAndLogin(
			api,
			hubEmail2,
			TEST_PASSWORD
		);
		const regionalId1 = await getHubUserRegionalId(hubEmail1);
		try {
			const stintId = await createTestWorkEmailStintDirect(
				regionalId1!,
				workEmail,
				"active"
			);

			const resp = await api.getMyWorkEmail(sessionToken2, {
				stint_id: stintId,
			});
			expect(resp.status).toBe(404);
		} finally {
			await deleteTestHubUser(hubEmail1);
			await deleteTestHubUser(hubEmail2);
			await deleteEmailsFor(hubEmail1);
			await deleteEmailsFor(hubEmail2);
		}
	});

	test("unauthenticated returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const resp = await api.getMyWorkEmailRaw("bad-token", {
			stint_id: "00000000-0000-0000-0000-000000000000",
		});
		expect(resp.status).toBe(401);
	});
});

// ============================================================================
// POST /hub/list-public-employer-stints
// ============================================================================
test.describe("POST /hub/list-public-employer-stints", () => {
	test("success returns active and ended stints, excludes pending", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-pub-ok@${sharedDomain}`;
		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		const regionalId = await getHubUserRegionalId(hubEmail);
		try {
			// Get handle
			const myInfoResp = await api.getMyInfo(sessionToken);
			expect(myInfoResp.status).toBe(200);
			const handle = myInfoResp.body.handle;

			// Create stints: active + ended + pending
			await createTestWorkEmailStintDirect(
				regionalId!,
				`pub-act-${Date.now()}@corp-pub.example`,
				"active"
			);
			await createTestWorkEmailStintDirect(
				regionalId!,
				`pub-end-${Date.now()}@corp-pub.example`,
				"ended"
			);
			await createTestWorkEmailStintDirect(
				regionalId!,
				`pub-pend-${Date.now()}@corp-pub.example`,
				"pending_verification"
			);

			const resp = await api.listPublicEmployerStints(sessionToken, {
				handle,
			});
			expect(resp.status).toBe(200);
			// Should include active + ended, NOT pending
			expect(resp.body.stints.length).toBeGreaterThanOrEqual(2);
			const statuses = resp.body.stints.map((s) =>
				s.is_current ? "active" : "ended"
			);
			expect(statuses).not.toContain("pending_verification");
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("unknown handle returns 200 with empty list", async ({ request }) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-pub-unk@${sharedDomain}`;
		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const resp = await api.listPublicEmployerStints(sessionToken, {
				handle: "nonexistent-handle-xyz-99999",
			});
			expect(resp.status).toBe(200);
			expect(resp.body.stints).toHaveLength(0);
		} finally {
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});

	test("unauthenticated returns 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const resp = await api.listPublicEmployerStintsRaw("bad-token", {
			handle: "somehandle",
		});
		expect(resp.status).toBe(401);
	});
});

// ============================================================================
// Blocklist interaction via add-work-email
// ============================================================================
test.describe("Blocklist interaction", () => {
	test("newly blocked domain prevents add-work-email (422)", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const hubEmail = `we-blist-hub@${sharedDomain}`;
		const testBlockDomain = `btest-${Date.now()}.example`;
		const workEmail = `alice@${testBlockDomain}`;

		await addPersonalDomainBlocklistEntry(testBlockDomain);
		const sessionToken = await createHubUserAndLogin(
			api,
			hubEmail,
			TEST_PASSWORD
		);
		try {
			const resp = await api.addWorkEmail(sessionToken, {
				email_address: workEmail,
			});
			expect(resp.status).toBe(422);
		} finally {
			await removePersonalDomainBlocklistEntry(testBlockDomain);
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
		}
	});
});
