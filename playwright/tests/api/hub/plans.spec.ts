import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
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
	getHubUserGlobalId,
	getHubUserPlanDirect,
	seedHubPlanDirect,
	deleteHubPlanDirect,
} from "../../../lib/db";
import {
	waitForEmail,
	getEmailContent,
	getTfaCodeFromEmail,
	deleteEmailsFor,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	HubLoginRequest,
	HubTFARequest,
	RequestSignupRequest,
	CompleteSignupRequest,
} from "vetchium-specs/hub/hub-users";

async function getHubSessionToken(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<string> {
	await deleteEmailsFor(email);
	const loginRequest: HubLoginRequest = { email_address: email, password };
	const loginResponse = await api.login(loginRequest);
	expect(loginResponse.status).toBe(200);

	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRequest: HubTFARequest = {
		tfa_token: loginResponse.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	};
	const tfaResponse = await api.verifyTFA(tfaRequest);
	expect(tfaResponse.status).toBe(200);
	return tfaResponse.body.session_token;
}

async function createHubUserViaSignup(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<void> {
	const requestSignup: RequestSignupRequest = { email_address: email };
	await api.requestSignup(requestSignup);

	const emailSummary = await waitForEmail(email);
	const emailMessage = await getEmailContent(emailSummary.ID);
	const signupToken = extractSignupTokenFromEmail(emailMessage);

	const completeSignup: CompleteSignupRequest = {
		signup_token: signupToken!,
		password,
		preferred_display_name: "Plan Test User",
		home_region: "ind1",
		preferred_language: "en-US",
		resident_country_code: "US",
	};
	await api.completeSignup(completeSignup);
}

test.describe("POST /hub/list-plans", () => {
	test("returns the active plan catalog (free + pro) for a valid session", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `plan-list-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			await createHubUserViaSignup(api, email, TEST_PASSWORD);
			const token = await getHubSessionToken(api, email, TEST_PASSWORD);

			const response = await api.listPlans(token);
			expect(response.status).toBe(200);
			expect(Array.isArray(response.body.plans)).toBe(true);

			const ids = response.body.plans.map((p) => p.plan_id);
			expect(ids).toContain("free");
			expect(ids).toContain("pro");

			const free = response.body.plans.find((p) => p.plan_id === "free")!;
			const pro = response.body.plans.find((p) => p.plan_id === "pro")!;
			expect(free.can_upload_profile_picture).toBe(false);
			expect(pro.can_upload_profile_picture).toBe(true);
			// Ordered by display_order
			expect(free.display_order).toBeLessThan(pro.display_order);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("returns 401 without a session token", async ({ request }) => {
		const api = new HubAPIClient(request);
		const response = await api.listPlansWithoutAuth();
		expect(response.status).toBe(401);
	});
});

test.describe("POST /hub/switch-plan — lifecycle", () => {
	test.describe.configure({ mode: "serial" });

	let adminEmail: string;
	let domain: string;
	let email: string;
	let token: string;
	let hubUserGlobalId: string;

	test.beforeAll(async ({ request }) => {
		const client = new HubAPIClient(request);
		adminEmail = generateTestEmail("admin");
		domain = generateTestDomainName();
		email = `plan-switch-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		await createHubUserViaSignup(client, email, TEST_PASSWORD);
		token = await getHubSessionToken(client, email, TEST_PASSWORD);
		hubUserGlobalId = (await getHubUserGlobalId(email))!;
	});

	test.afterAll(async () => {
		await deleteTestHubUser(email);
		await permanentlyDeleteTestApprovedDomain(domain);
		await deleteTestAdminUser(adminEmail);
	});

	test("new user defaults to free and myinfo reports free caps", async ({
		request,
	}) => {
		const client = new HubAPIClient(request);
		expect(await getHubUserPlanDirect(hubUserGlobalId)).toBe("free");
		const info = await client.getMyInfo(token);
		expect(info.status).toBe(200);
		expect(info.body.plan_id).toBe("free");
		expect(info.body.can_upload_profile_picture).toBe(false);
		expect(info.body.can_post_messages).toBe(false);
	});

	test("free → pro succeeds, updates caps, and writes an audit log", async ({
		request,
	}) => {
		const client = new HubAPIClient(request);
		const before = await client.listAuditLogs(token, {
			event_types: ["hub.switch_plan"],
		});
		const beforeCount = before.body.audit_logs?.length ?? 0;

		const res = await client.switchPlan(token, { plan_id: "pro" });
		expect(res.status).toBe(200);
		expect(res.body.plan_id).toBe("pro");
		expect(res.body.can_upload_profile_picture).toBe(true);

		expect(await getHubUserPlanDirect(hubUserGlobalId)).toBe("pro");
		const info = await client.getMyInfo(token);
		expect(info.body.plan_id).toBe("pro");
		expect(info.body.can_upload_profile_picture).toBe(true);

		const after = await client.listAuditLogs(token, {
			event_types: ["hub.switch_plan"],
		});
		expect(after.body.audit_logs?.length ?? 0).toBe(beforeCount + 1);
	});

	test("pro → free succeeds", async ({ request }) => {
		const client = new HubAPIClient(request);
		const res = await client.switchPlan(token, { plan_id: "free" });
		expect(res.status).toBe(200);
		expect(res.body.plan_id).toBe("free");
		expect(res.body.can_upload_profile_picture).toBe(false);
		expect(await getHubUserPlanDirect(hubUserGlobalId)).toBe("free");
	});

	test("no-op switch (free → free) returns 200 and writes no audit log", async ({
		request,
	}) => {
		const client = new HubAPIClient(request);
		const before = await client.listAuditLogs(token, {
			event_types: ["hub.switch_plan"],
		});
		const beforeCount = before.body.audit_logs?.length ?? 0;

		const res = await client.switchPlan(token, { plan_id: "free" });
		expect(res.status).toBe(200);
		expect(res.body.plan_id).toBe("free");

		const after = await client.listAuditLogs(token, {
			event_types: ["hub.switch_plan"],
		});
		expect(after.body.audit_logs?.length ?? 0).toBe(beforeCount);
	});
});

test.describe("POST /hub/switch-plan — validation & errors", () => {
	let adminEmail: string;
	let domain: string;
	let email: string;
	let token: string;

	test.beforeAll(async ({ request }) => {
		const client = new HubAPIClient(request);
		adminEmail = generateTestEmail("admin");
		domain = generateTestDomainName();
		email = `plan-err-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		await createHubUserViaSignup(client, email, TEST_PASSWORD);
		token = await getHubSessionToken(client, email, TEST_PASSWORD);
	});

	test.afterAll(async () => {
		await deleteTestHubUser(email);
		await permanentlyDeleteTestApprovedDomain(domain);
		await deleteTestAdminUser(adminEmail);
	});

	test("empty plan_id → 400", async ({ request }) => {
		const api = new HubAPIClient(request);
		const res = await api.switchPlanRaw(token, { plan_id: "" });
		expect(res.status).toBe(400);
	});

	test("unknown plan → 404", async ({ request }) => {
		const api = new HubAPIClient(request);
		const res = await api.switchPlanRaw(token, {
			plan_id: `ghost-${randomUUID().substring(0, 8)}`,
		});
		expect(res.status).toBe(404);
	});

	test("retired plan → 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const planId = `rt-${randomUUID().substring(0, 8)}`;
		await seedHubPlanDirect(planId, { status: "retired" });
		try {
			const res = await api.switchPlanRaw(token, { plan_id: planId });
			expect(res.status).toBe(422);
		} finally {
			await deleteHubPlanDirect(planId);
		}
	});

	test("non-self-upgradeable plan → 422", async ({ request }) => {
		const api = new HubAPIClient(request);
		const planId = `ns-${randomUUID().substring(0, 8)}`;
		await seedHubPlanDirect(planId, { selfUpgradeable: false });
		try {
			const res = await api.switchPlanRaw(token, { plan_id: planId });
			expect(res.status).toBe(422);
		} finally {
			await deleteHubPlanDirect(planId);
		}
	});

	test("unauthenticated → 401", async ({ request }) => {
		const api = new HubAPIClient(request);
		const res = await api.switchPlanWithoutAuth({ plan_id: "pro" });
		expect(res.status).toBe(401);
	});
});
