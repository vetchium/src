import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	generateTestOrgEmail,
	deleteTestOrgUser,
	deleteTestGlobalOrgDomain,
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
import type {
	ClaimDomainRequest,
	GetDomainStatusRequest,
} from "vetchium-specs/org-domains/org-domains";

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

test.describe("POST /org/get-domain-status", () => {
	test("get status of pending domain returns correct info", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("status-claimed");

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"status-success"
			);
			userEmail = email;

			// Claim domain first
			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const claimResponse = await api.claimDomain(sessionToken, claimRequest);
			expect(claimResponse.status).toBe(201);
			const verificationToken = claimResponse.body.verification_token;

			// Get status
			const statusRequest: GetDomainStatusRequest = {
				domain: claimedDomain,
			};
			const response = await api.getDomainStatus(sessionToken, statusRequest);

			expect(response.status).toBe(200);
			expect(response.body.domain).toBe(claimedDomain.toLowerCase());
			expect(response.body.status).toBe("PENDING");
			expect(response.body.verification_token).toBe(verificationToken);
			expect(response.body.expires_at).toBeDefined();
		} finally {
			await deleteTestGlobalOrgDomain(claimedDomain);
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const statusRequest: GetDomainStatusRequest = {
			domain: "example.com",
		};
		const response = await api.getDomainStatusWithoutAuth(statusRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new OrgAPIClient(request);

		const statusRequest: GetDomainStatusRequest = {
			domain: "example.com",
		};
		const response = await api.getDomainStatus(
			"ind1-" + "a".repeat(64), // Invalid token
			statusRequest
		);

		expect(response.status).toBe(401);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"status-missing-domain"
			);
			userEmail = email;

			const response = await api.getDomainStatusRaw(sessionToken, {});

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
				"status-empty-domain"
			);
			userEmail = email;

			const response = await api.getDomainStatusRaw(sessionToken, {
				domain: "",
			});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("unclaimed domain returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createOrgUserAndGetSession(
				api,
				"status-unclaimed"
			);
			userEmail = email;

			// Get status of a domain that was never claimed
			const statusRequest: GetDomainStatusRequest = {
				domain: "unclaimed-" + Date.now() + ".example.com",
			};
			const response = await api.getDomainStatus(sessionToken, statusRequest);

			expect(response.status).toBe(404);
		} finally {
			if (userEmail) await deleteTestOrgUser(userEmail);
		}
	});

	test("domain owned by another org returns 404", async ({ request }) => {
		const api = new OrgAPIClient(request);
		let userEmail1 = "";
		let userEmail2 = "";
		const claimedDomain = generateTestDomainName("status-owned");

		try {
			// First user claims the domain
			const { email: email1, sessionToken: token1 } =
				await createOrgUserAndGetSession(api, "status-owner1");
			userEmail1 = email1;

			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const claimResponse = await api.claimDomain(token1, claimRequest);
			expect(claimResponse.status).toBe(201);

			// Second user tries to get status of the domain (should fail)
			const { email: email2, sessionToken: token2 } =
				await createOrgUserAndGetSession(api, "status-owner2");
			userEmail2 = email2;

			const statusRequest: GetDomainStatusRequest = {
				domain: claimedDomain,
			};
			const response = await api.getDomainStatus(token2, statusRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestGlobalOrgDomain(claimedDomain);
			if (userEmail1) await deleteTestOrgUser(userEmail1);
			if (userEmail2) await deleteTestOrgUser(userEmail2);
		}
	});
});

test.describe("RBAC: POST /org/get-domain-status", () => {
	let viewerToken: string;
	let noRoleToken: string;
	let adminEmail: string;
	let viewerEmail: string;
	let noRoleEmail: string;
	let domain: string;
	let claimedDomain: string;

	test.beforeAll(async ({ request }) => {
		const api = new OrgAPIClient(request);

		const generated = generateTestOrgEmail("rbac-gds-emp");
		adminEmail = generated.email;
		domain = generated.domain;
		const adminResult = await createTestOrgAdminDirect(
			adminEmail,
			TEST_PASSWORD,
			"ind1"
		);

		// Claim a fresh domain for get-domain-status tests
		claimedDomain = generateTestDomainName("rbac-gds-cl");
		const adminLoginRes = await api.login({
			email: adminEmail,
			domain,
			password: TEST_PASSWORD,
		});
		const adminTfaCode = await getTfaCodeFromEmail(adminEmail);
		const adminTfaRes = await api.verifyTFA({
			tfa_token: adminLoginRes.body.tfa_token,
			tfa_code: adminTfaCode,
			remember_me: false,
		});
		await api.claimDomain(adminTfaRes.body.session_token, {
			domain: claimedDomain,
		});

		viewerEmail = `viewer@${domain}`;
		const viewerResult = await createTestOrgUserDirect(
			viewerEmail,
			TEST_PASSWORD,
			"ind1",
			{ orgId: adminResult.orgId, domain }
		);
		await assignRoleToOrgUser(viewerResult.orgUserId, "org:view_domains");
		const viewerLoginRes = await api.login({
			email: viewerEmail,
			domain,
			password: TEST_PASSWORD,
		});
		const viewerTfaCode = await getTfaCodeFromEmail(viewerEmail);
		const viewerTfaRes = await api.verifyTFA({
			tfa_token: viewerLoginRes.body.tfa_token,
			tfa_code: viewerTfaCode,
			remember_me: false,
		});
		viewerToken = viewerTfaRes.body.session_token;

		noRoleEmail = `norole@${domain}`;
		await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			orgId: adminResult.orgId,
			domain,
		});
		const noRoleLoginRes = await api.login({
			email: noRoleEmail,
			domain,
			password: TEST_PASSWORD,
		});
		const noRoleTfaCode = await getTfaCodeFromEmail(noRoleEmail);
		const noRoleTfaRes = await api.verifyTFA({
			tfa_token: noRoleLoginRes.body.tfa_token,
			tfa_code: noRoleTfaCode,
			remember_me: false,
		});
		noRoleToken = noRoleTfaRes.body.session_token;
	});

	test.afterAll(async () => {
		await deleteTestGlobalOrgDomain(claimedDomain);
		await deleteTestOrgUser(viewerEmail);
		await deleteTestOrgUser(noRoleEmail);
		await deleteTestOrgUser(adminEmail);
	});

	test("org user WITH view_domains can get-domain-status (200)", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const response = await api.getDomainStatus(viewerToken, {
			domain: claimedDomain,
		});
		expect(response.status).toBe(200);
	});

	test("org user WITHOUT role gets 403 on get-domain-status", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const response = await api.getDomainStatus(noRoleToken, {
			domain: claimedDomain,
		});
		expect(response.status).toBe(403);
	});
});
