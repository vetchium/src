import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	generateTestAgencyEmail,
	deleteTestAgencyUser,
	deleteTestGlobalAgencyDomain,
	createTestAgencyAdminDirect,
	createTestAgencyUserDirect,
	generateTestDomainName,
	assignRoleToAgencyUser,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AgencyLoginRequest,
	AgencyTFARequest,
} from "vetchium-specs/agency/agency-users";
import type {
	AgencyClaimDomainRequest,
	AgencyGetDomainStatusRequest,
} from "vetchium-specs/agency-domains/agency-domains";

/**
 * Helper to create an agency admin and return session token.
 */
async function createAgencyAdminAndGetSession(
	api: AgencyAPIClient,
	emailPrefix: string
): Promise<{ email: string; sessionToken: string }> {
	const { email, domain } = generateTestAgencyEmail(emailPrefix);

	await createTestAgencyAdminDirect(email, TEST_PASSWORD);
	await deleteEmailsFor(email);

	const loginRequest: AgencyLoginRequest = {
		email,
		domain,
		password: TEST_PASSWORD,
	};
	const loginResponse = await api.login(loginRequest);
	expect(loginResponse.status).toBe(200);

	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaRequest: AgencyTFARequest = {
		tfa_token: loginResponse.body.tfa_token,
		tfa_code: tfaCode,
		remember_me: false,
	};
	const tfaResponse = await api.verifyTFA(tfaRequest);
	expect(tfaResponse.status).toBe(200);

	return { email, sessionToken: tfaResponse.body.session_token };
}

test.describe("POST /agency/get-domain-status", () => {
	test("get status of pending domain returns correct info", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("agency-status-claimed");

		try {
			const { email, sessionToken } = await createAgencyAdminAndGetSession(
				api,
				"agency-status-success"
			);
			userEmail = email;

			// Claim domain first
			const claimRequest: AgencyClaimDomainRequest = {
				domain: claimedDomain,
			};
			const claimResponse = await api.claimDomain(sessionToken, claimRequest);
			expect(claimResponse.status).toBe(201);
			const verificationToken = claimResponse.body.verification_token;

			// Get status
			const statusRequest: AgencyGetDomainStatusRequest = {
				domain: claimedDomain,
			};
			const response = await api.getDomainStatus(sessionToken, statusRequest);

			expect(response.status).toBe(200);
			expect(response.body.domain).toBe(claimedDomain.toLowerCase());
			expect(response.body.status).toBe("PENDING");
			expect(response.body.verification_token).toBe(verificationToken);
			expect(response.body.expires_at).toBeDefined();
		} finally {
			await deleteTestGlobalAgencyDomain(claimedDomain);
			if (userEmail) await deleteTestAgencyUser(userEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const statusRequest: AgencyGetDomainStatusRequest = {
			domain: "example.com",
		};
		const response = await api.getDomainStatusWithoutAuth(statusRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const statusRequest: AgencyGetDomainStatusRequest = {
			domain: "example.com",
		};
		const response = await api.getDomainStatus(
			"ind1-" + "a".repeat(64),
			statusRequest
		);

		expect(response.status).toBe(401);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createAgencyAdminAndGetSession(
				api,
				"agency-status-missing"
			);
			userEmail = email;

			const response = await api.getDomainStatusRaw(sessionToken, {});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestAgencyUser(userEmail);
		}
	});

	test("empty domain returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createAgencyAdminAndGetSession(
				api,
				"agency-status-empty"
			);
			userEmail = email;

			const response = await api.getDomainStatusRaw(sessionToken, {
				domain: "",
			});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestAgencyUser(userEmail);
		}
	});

	test("unclaimed domain returns 404", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createAgencyAdminAndGetSession(
				api,
				"agency-status-unclaimed"
			);
			userEmail = email;

			const statusRequest: AgencyGetDomainStatusRequest = {
				domain: "unclaimed-" + Date.now() + ".example.com",
			};
			const response = await api.getDomainStatus(sessionToken, statusRequest);

			expect(response.status).toBe(404);
		} finally {
			if (userEmail) await deleteTestAgencyUser(userEmail);
		}
	});

	test("domain owned by another agency returns 404", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		let userEmail1 = "";
		let userEmail2 = "";
		const claimedDomain = generateTestDomainName("agency-status-owned");

		try {
			// First agency claims the domain
			const { email: email1, sessionToken: token1 } =
				await createAgencyAdminAndGetSession(api, "agency-status-owner1");
			userEmail1 = email1;

			const claimRequest: AgencyClaimDomainRequest = {
				domain: claimedDomain,
			};
			const claimResponse = await api.claimDomain(token1, claimRequest);
			expect(claimResponse.status).toBe(201);

			// Second agency tries to get status (should fail)
			const { email: email2, sessionToken: token2 } =
				await createAgencyAdminAndGetSession(api, "agency-status-owner2");
			userEmail2 = email2;

			const statusRequest: AgencyGetDomainStatusRequest = {
				domain: claimedDomain,
			};
			const response = await api.getDomainStatus(token2, statusRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestGlobalAgencyDomain(claimedDomain);
			if (userEmail1) await deleteTestAgencyUser(userEmail1);
			if (userEmail2) await deleteTestAgencyUser(userEmail2);
		}
	});
});

test.describe("RBAC: POST /agency/get-domain-status", () => {
	let viewerToken: string;
	let noRoleToken: string;
	let adminEmail: string;
	let viewerEmail: string;
	let noRoleEmail: string;
	let domain: string;
	let claimedDomain: string;

	test.beforeAll(async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const generated = generateTestAgencyEmail("rbac-gds-agn");
		adminEmail = generated.email;
		domain = generated.domain;
		const adminResult = await createTestAgencyAdminDirect(
			adminEmail,
			TEST_PASSWORD,
			"ind1"
		);

		// Claim a fresh domain for get-domain-status tests
		claimedDomain = generateTestDomainName("rbac-agds-cl");
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
		const viewerResult = await createTestAgencyUserDirect(
			viewerEmail,
			TEST_PASSWORD,
			"ind1",
			{ agencyId: adminResult.agencyId, domain }
		);
		await assignRoleToAgencyUser(
			viewerResult.agencyUserId,
			"agency:view_domains"
		);
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
		await createTestAgencyUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
			agencyId: adminResult.agencyId,
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
		await deleteTestGlobalAgencyDomain(claimedDomain);
		await deleteTestAgencyUser(viewerEmail);
		await deleteTestAgencyUser(noRoleEmail);
		await deleteTestAgencyUser(adminEmail);
	});

	test("agency user WITH view_domains can get-domain-status (200)", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const response = await api.getDomainStatus(viewerToken, {
			domain: claimedDomain,
		});
		expect(response.status).toBe(200);
	});

	test("agency user WITHOUT role gets 403 on get-domain-status", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		const response = await api.getDomainStatus(noRoleToken, {
			domain: claimedDomain,
		});
		expect(response.status).toBe(403);
	});
});
