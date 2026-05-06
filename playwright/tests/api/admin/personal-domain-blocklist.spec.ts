/**
 * Tests for Admin Personal Domain Blocklist endpoints:
 *   POST /admin/list-blocked-personal-domains
 *   POST /admin/add-blocked-personal-domain
 *   POST /admin/remove-blocked-personal-domain
 *
 * Also tests the cross-effect on Hub work-email validation:
 *   - Adding a domain to the blocklist causes /hub/add-work-email to return 422
 *   - Removing a domain from the blocklist allows /hub/add-work-email to succeed
 */
import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestAdminUser,
	createTestAdminUserDirect,
	deleteTestAdminUser,
	deleteTestHubUser,
	generateTestEmail,
	generateTestDomainName,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
	assignRoleToAdminUser,
	addPersonalDomainBlocklistEntry,
	removePersonalDomainBlocklistEntry,
	extractSignupTokenFromEmail,
} from "../../../lib/db";
import {
	waitForEmail,
	getEmailContent,
	getTfaCodeFromEmail,
	deleteEmailsFor,
} from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	RequestSignupRequest,
	CompleteSignupRequest,
	HubLoginRequest,
} from "vetchium-specs/hub/hub-users";

// ============================================================================
// Helper: log in as admin and return a session token
// ============================================================================
async function adminLogin(
	api: AdminAPIClient,
	email: string,
	password: string
): Promise<string> {
	const loginResp = await api.login({ email, password });
	expect(loginResp.status).toBe(200);
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaResp = await api.verifyTFA({
		tfa_token: loginResp.body.tfa_token,
		tfa_code: tfaCode,
	});
	expect(tfaResp.status).toBe(200);
	return tfaResp.body.session_token;
}

// ============================================================================
// Helper: create hub user, complete signup, log in, return session token
// ============================================================================
async function createHubUserAndLogin(
	api: HubAPIClient,
	email: string,
	password: string,
	displayName: string = "Blocklist Test User"
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
// Shared approved domain for hub signups in cross-effect tests
// ============================================================================
let sharedAdminEmail: string;
let sharedApprovedDomain: string;

test.beforeAll(async ({ request }) => {
	sharedAdminEmail = generateTestEmail("pdb-admin");
	sharedApprovedDomain = generateTestDomainName("pdb");
	await createTestAdminUser(sharedAdminEmail, TEST_PASSWORD);
	await createTestApprovedDomain(sharedApprovedDomain, sharedAdminEmail);
});

test.afterAll(async () => {
	await permanentlyDeleteTestApprovedDomain(sharedApprovedDomain);
	await deleteTestAdminUser(sharedAdminEmail);
});

// ============================================================================
// POST /admin/list-blocked-personal-domains
// ============================================================================
test.describe("POST /admin/list-blocked-personal-domains", () => {
	test("success — returns 200 with domains array", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-list-ok");

		const adminId = await createTestAdminUser(email, TEST_PASSWORD);
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);
		try {
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.listBlockedPersonalDomains(sessionToken, {});
			expect(resp.status).toBe(200);
			expect(Array.isArray(resp.body.domains)).toBe(true);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("filter_domain_prefix narrows results", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-list-filter");
		const uniquePrefix = `pdbtest-${Date.now()}`;
		const domainA = `${uniquePrefix}-alpha.com`;
		const domainB = `${uniquePrefix}-beta.com`;
		const unrelatedDomain = `unrelated-${Date.now()}.com`;

		const adminId = await createTestAdminUser(email, TEST_PASSWORD);
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);
		await addPersonalDomainBlocklistEntry(domainA);
		await addPersonalDomainBlocklistEntry(domainB);
		await addPersonalDomainBlocklistEntry(unrelatedDomain);
		try {
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.listBlockedPersonalDomains(sessionToken, {
				filter_domain_prefix: uniquePrefix,
			});
			expect(resp.status).toBe(200);
			const names = resp.body.domains.map((d) => d.domain);
			expect(names).toContain(domainA);
			expect(names).toContain(domainB);
			expect(names).not.toContain(unrelatedDomain);
		} finally {
			await removePersonalDomainBlocklistEntry(domainA);
			await removePersonalDomainBlocklistEntry(domainB);
			await removePersonalDomainBlocklistEntry(unrelatedDomain);
			await deleteTestAdminUser(email);
		}
	});

	test("missing session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const resp = await api.listBlockedPersonalDomains("", {});
		expect(resp.status).toBe(401);
	});
});

// ============================================================================
// POST /admin/add-blocked-personal-domain
// ============================================================================
test.describe("POST /admin/add-blocked-personal-domain", () => {
	test("success — adds domain and returns 201 with domain details", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-add-ok");
		const domain = `pdb-add-${Date.now()}.example.com`;

		const adminId = await createTestAdminUser(email, TEST_PASSWORD);
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);
		// Also need view_audit_logs to read back the audit entry
		await assignRoleToAdminUser(adminId, "admin:view_audit_logs");
		try {
			const before = new Date(Date.now() - 2000).toISOString();
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.addBlockedPersonalDomain(sessionToken, {
				domain,
			});
			expect(resp.status).toBe(201);
			expect(resp.body.domain).toBe(domain.toLowerCase());
			expect(resp.body.created_at).toBeTruthy();

			// Audit log written — filter by actor to avoid interference with parallel tests
			const auditResp = await api.listAuditLogs(sessionToken, {
				event_types: ["admin.add_blocked_personal_domain"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			// Find the entry for this specific domain (parallel tests may emit same event_type)
			const entry = auditResp.body.audit_logs.find(
				(e) =>
					e.event_type === "admin.add_blocked_personal_domain" &&
					e.event_data?.domain === domain.toLowerCase()
			);
			expect(entry).toBeDefined();
			expect(entry!.event_data).toHaveProperty("domain");
		} finally {
			await removePersonalDomainBlocklistEntry(domain);
			await deleteTestAdminUser(email);
		}
	});

	test("adding same domain twice returns 409", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-add-dup");
		const domain = `pdb-dup-${Date.now()}.example.com`;

		const adminId = await createTestAdminUser(email, TEST_PASSWORD);
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);
		try {
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			// Add first time — should succeed
			const first = await api.addBlockedPersonalDomain(sessionToken, {
				domain,
			});
			expect(first.status).toBe(201);

			// Add second time — should conflict
			const second = await api.addBlockedPersonalDomain(sessionToken, {
				domain,
			});
			expect(second.status).toBe(409);
		} finally {
			await removePersonalDomainBlocklistEntry(domain);
			await deleteTestAdminUser(email);
		}
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-add-empty");

		const adminId = await createTestAdminUser(email, TEST_PASSWORD);
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);
		try {
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.addBlockedPersonalDomainRaw(sessionToken, {
				domain: "",
			});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("missing domain field returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-add-missing");

		const adminId = await createTestAdminUser(email, TEST_PASSWORD);
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);
		try {
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.addBlockedPersonalDomainRaw(sessionToken, {});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("missing session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const domain = `pdb-noauth-${Date.now()}.example.com`;
		const resp = await api.addBlockedPersonalDomain("", { domain });
		expect(resp.status).toBe(401);
	});

	test("RBAC negative — admin without role returns 403", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-add-no-role");
		const domain = `pdb-no-role-${Date.now()}.example.com`;

		// createTestAdminUserDirect creates a user with NO roles
		await createTestAdminUserDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.addBlockedPersonalDomain(sessionToken, {
				domain,
			});
			expect(resp.status).toBe(403);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("RBAC positive — admin with manage_personal_domain_blocklist role returns 201", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-add-rbac-ok");
		const domain = `pdb-rbac-ok-${Date.now()}.example.com`;

		const adminId = await createTestAdminUser(email, TEST_PASSWORD);
		// Grant only the specific role — NOT superadmin
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);
		try {
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.addBlockedPersonalDomain(sessionToken, {
				domain,
			});
			expect(resp.status).toBe(201);
		} finally {
			await removePersonalDomainBlocklistEntry(domain);
			await deleteTestAdminUser(email);
		}
	});
});

// ============================================================================
// POST /admin/remove-blocked-personal-domain
// ============================================================================
test.describe("POST /admin/remove-blocked-personal-domain", () => {
	test("success — removes domain and returns 204", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-rm-ok");
		const domain = `pdb-rm-${Date.now()}.example.com`;

		const adminId = await createTestAdminUser(email, TEST_PASSWORD);
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);
		// Also need view_audit_logs to read back the audit entry
		await assignRoleToAdminUser(adminId, "admin:view_audit_logs");
		await addPersonalDomainBlocklistEntry(domain);
		try {
			const before = new Date(Date.now() - 2000).toISOString();
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.removeBlockedPersonalDomain(sessionToken, {
				domain,
			});
			expect(resp.status).toBe(204);

			// Audit log written — filter by domain to avoid interference with parallel tests
			const auditResp = await api.listAuditLogs(sessionToken, {
				event_types: ["admin.remove_blocked_personal_domain"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			const entry = auditResp.body.audit_logs.find(
				(e) =>
					e.event_type === "admin.remove_blocked_personal_domain" &&
					e.event_data?.domain === domain.toLowerCase()
			);
			expect(entry).toBeDefined();
			expect(entry!.event_data).toHaveProperty("domain");
		} finally {
			// In case remove failed, clean up directly
			await removePersonalDomainBlocklistEntry(domain);
			await deleteTestAdminUser(email);
		}
	});

	test("non-existent domain returns 404", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-rm-404");
		const domain = `pdb-rm-missing-${Date.now()}.example.com`;

		const adminId = await createTestAdminUser(email, TEST_PASSWORD);
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);
		try {
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.removeBlockedPersonalDomain(sessionToken, {
				domain,
			});
			expect(resp.status).toBe(404);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-rm-empty");

		const adminId = await createTestAdminUser(email, TEST_PASSWORD);
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);
		try {
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.removeBlockedPersonalDomainRaw(sessionToken, {
				domain: "",
			});
			expect(resp.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("missing session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const domain = `pdb-rm-noauth-${Date.now()}.example.com`;
		const resp = await api.removeBlockedPersonalDomain("", { domain });
		expect(resp.status).toBe(401);
	});

	test("RBAC negative — admin without role returns 403", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("pdb-rm-no-role");
		const domain = `pdb-rm-no-role-${Date.now()}.example.com`;

		await addPersonalDomainBlocklistEntry(domain);
		await createTestAdminUserDirect(email, TEST_PASSWORD);
		try {
			const sessionToken = await adminLogin(api, email, TEST_PASSWORD);

			const resp = await api.removeBlockedPersonalDomain(sessionToken, {
				domain,
			});
			expect(resp.status).toBe(403);
		} finally {
			await removePersonalDomainBlocklistEntry(domain);
			await deleteTestAdminUser(email);
		}
	});
});

// ============================================================================
// Cross-effect: blocklist blocks Hub work-email add; removing unblocks
// ============================================================================
test.describe("Cross-effect: blocklist ↔ hub add-work-email", () => {
	test("adding a domain to blocklist causes hub add-work-email to return 422, removing it allows success", async ({
		request,
	}) => {
		const adminApi = new AdminAPIClient(request);
		const hubApi = new HubAPIClient(request);

		const adminEmail = generateTestEmail("pdb-cross-admin");
		const hubEmail = `pdb-cross-hub@${sharedApprovedDomain}`;
		const workDomain = `pdb-cross-corp-${Date.now()}.example.com`;
		const workEmail = `alice@${workDomain}`;

		const adminId = await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await assignRoleToAdminUser(
			adminId,
			"admin:manage_personal_domain_blocklist"
		);

		try {
			// Hub user signup and login
			const hubSessionToken = await createHubUserAndLogin(
				hubApi,
				hubEmail,
				TEST_PASSWORD
			);

			// Confirm the work email domain is not yet blocked — add-work-email should succeed
			const preBlockResp = await hubApi.addWorkEmail(hubSessionToken, {
				email_address: workEmail,
			});
			// Expect 201 before domain is blocked
			// (If there's already an active stint for this email this would be 409 — but since
			// workDomain is unique per run, it should be 201.)
			expect(preBlockResp.status).toBe(201);

			// Admin adds the domain to the blocklist
			const adminSessionToken = await adminLogin(
				adminApi,
				adminEmail,
				TEST_PASSWORD
			);
			const addResp = await adminApi.addBlockedPersonalDomain(
				adminSessionToken,
				{ domain: workDomain }
			);
			expect(addResp.status).toBe(201);

			// Now hub user tries to add a second work email from the same domain
			// (use a different local part to avoid duplicate-email 409)
			const workEmail2 = `bob@${workDomain}`;
			const postBlockResp = await hubApi.addWorkEmail(hubSessionToken, {
				email_address: workEmail2,
			});
			expect(postBlockResp.status).toBe(422);

			// Admin removes the domain from the blocklist
			const removeResp = await adminApi.removeBlockedPersonalDomain(
				adminSessionToken,
				{ domain: workDomain }
			);
			expect(removeResp.status).toBe(204);

			// After removal, hub user should be able to add work email again
			const postUnblockResp = await hubApi.addWorkEmail(hubSessionToken, {
				email_address: workEmail2,
			});
			expect(postUnblockResp.status).toBe(201);
		} finally {
			await removePersonalDomainBlocklistEntry(workDomain);
			await deleteTestHubUser(hubEmail);
			await deleteEmailsFor(hubEmail);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
