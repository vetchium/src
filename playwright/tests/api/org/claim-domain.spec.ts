import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	deleteTestGlobalEmployerDomain,
	createTestOrgUserDirect,
	createTestOrgAdminDirect,
	generateTestDomainName,
	assignRoleToOrgUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type { ClaimDomainRequest } from "vetchium-specs/org-domains/org-domains";

/**
 * Helper to create an org user directly in DB and return the session token via login.
 */
async function createOrgUserAndGetSession(
	api: OrgAPIClient,
	emailPrefix: string
): Promise<{ email: string; sessionToken: string }> {
	const { email, domain } = generateTestOrgEmail(emailPrefix);

	// Create test org user directly in the database
	await createTestOrgAdminDirect(email, TEST_PASSWORD);

	// Clear any existing emails for this address
	await deleteEmailsFor(email);

	// Login to get TFA token
	const loginRequest: OrgLoginRequest = {
		email,
		domain,
		password: TEST_PASSWORD,
	};
	const loginResponse = await api.login(loginRequest);
	expect(loginResponse.status).toBe(200);
	expect(loginResponse.body.tfa_token).toBeDefined();

	// Get TFA code from email and verify
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRequest: OrgTFARequest = {
		tfa_token: loginResponse.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	};
	const tfaResponse = await api.verifyTFA(tfaRequest);
	expect(tfaResponse.status).toBe(200);
	expect(tfaResponse.body.session_token).toBeDefined();

	return { email, sessionToken: tfaResponse.body.session_token };
}

test.describe("POST /org/claim-domain", () => {
	test("successful domain claim returns verification token", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("claimed");

		try {
			// Create org user directly in DB and get session via login
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"claim-success"
			);
			userEmail = email;

			// Claim a new domain
			const before = new Date(Date.now() - 2000).toISOString();
			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const response = await api.claimDomain(sessionToken, claimRequest);

			expect(response.status).toBe(201);
			expect(response.body.domain).toBe(claimedDomain.toLowerCase());
			expect(response.body.verification_token).toBeDefined();
			expect(response.body.verification_token).toMatch(/^[a-f0-9]{64}$/);
			expect(response.body.expires_at).toBeDefined();
			expect(response.body.instructions).toBeDefined();

			// Verify org.claim_domain audit log entry was created
			const auditResp = await api.filterAuditLogs(sessionToken, {
				event_types: ["org.claim_domain"],
				start_time: before,
			});
			expect(auditResp.status).toBe(200);
			expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
			expect(auditResp.body.audit_logs[0].event_type).toBe(
				"org.claim_domain"
			);
		} finally {
			// Cleanup
			await deleteTestGlobalEmployerDomain(claimedDomain);
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const claimRequest: ClaimDomainRequest = {
			domain: "example.com",
		};
		const response = await api.claimDomainWithoutAuth(claimRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const claimRequest: ClaimDomainRequest = {
			domain: "example.com",
		};
		const response = await api.claimDomain(
			"ind1-" + "a".repeat(64), // Invalid token
			claimRequest
		);

		expect(response.status).toBe(401);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"claim-missing-domain"
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, {});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"claim-empty-domain"
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, { domain: "" });

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("invalid domain format returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"claim-invalid-format"
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, {
				domain: "not-a-valid-domain",
			});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("duplicate domain claim returns 409", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("dup-claimed");

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"claim-duplicate"
			);
			userEmail = email;

			// First claim
			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const response1 = await api.claimDomain(sessionToken, claimRequest);
			expect(response1.status).toBe(201);

			// Second claim of same domain
			const response2 = await api.claimDomain(sessionToken, claimRequest);
			expect(response2.status).toBe(409);
		} finally {
			await deleteTestGlobalEmployerDomain(claimedDomain);
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});
});

test.describe("RBAC: POST /org/claim-domain", () => {
	test("org user WITH org:manage_domains can claim-domain (201)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("rbac-cd-org-adm");
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD,
			"ind1"
		);

		const managerEmail = `mgr-${crypto.randomUUID().substring(0, 8)}@${domain}`;
		const managerResult = await createTestOrgUserDirect(
			managerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: adminResult.orgId, domain }
		);
		await assignRoleToOrgUser(
			managerResult.orgUserId,
			"org:manage_domains"
		);

		const freshDomain = generateTestDomainName("rbac-emp-clm");
		try {
			const loginRes = await api.login({
				email: managerEmail,
				domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(managerEmail);
			const tfaRes = await api.verifyTFA({
				tfa_token: loginRes.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const sessionToken = tfaRes.body.session_token;

			const response = await api.claimDomain(sessionToken, {
				domain: freshDomain,
			});
			expect(response.status).toBe(201);
		} finally {
			await deleteTestGlobalEmployerDomain(freshDomain);
			await deleteTestOrgUser(managerEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});

	test("org user WITHOUT role gets 403 on claim-domain", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email: adminEmail, domain } =
			generateTestOrgEmail("rbac-cd-norole");
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD,
			"ind1"
		);

		const noRoleEmail = `norole-${crypto.randomUUID().substring(0, 8)}@${domain}`;
		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId: adminResult.orgId,
			domain,
		});

		try {
			const loginRes = await api.login({
				email: noRoleEmail,
				domain,
				password: TEST_PASSWORD,
			});
			const tfaCode = await getTfaCodeFromEmail(noRoleEmail);
			const tfaRes = await api.verifyTFA({
				tfa_token: loginRes.body.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			});
			const noRoleToken = tfaRes.body.session_token;

			const response = await api.claimDomain(noRoleToken, { domain });
			expect(response.status).toBe(403);
		} finally {
			await deleteTestOrgUser(noRoleEmail);
			await deleteTestOrgUser(adminEmail);
		}
	});
});
