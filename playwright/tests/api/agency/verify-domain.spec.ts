import { test, expect } from "@playwright/test";
import { AgencyAPIClient } from "../../../lib/agency-api-client";
import {
	generateTestAgencyEmail,
	deleteTestAgencyUser,
	deleteTestGlobalAgencyDomain,
	createTestAgencyAdminDirect,
	generateTestDomainName,
} from "../../../lib/db";
import { getTfaCodeFromEmail, deleteEmailsFor } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	AgencyLoginRequest,
	AgencyTFARequest,
} from "vetchium-specs/agency/agency-users";
import type {
	ClaimDomainRequest,
	VerifyDomainRequest,
} from "vetchium-specs/employer-domains/employer-domains";

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

test.describe("POST /agency/verify-domain", () => {
	test("verify pending domain without DNS record returns PENDING", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("agency-to-verify");

		try {
			const { email, sessionToken } = await createAgencyAdminAndGetSession(
				api,
				"agency-verify-success"
			);
			userEmail = email;

			// Claim domain first
			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const claimResponse = await api.claimDomain(sessionToken, claimRequest);
			expect(claimResponse.status).toBe(201);

			// Verify - should return PENDING since no DNS record
			const verifyRequest: VerifyDomainRequest = {
				domain: claimedDomain,
			};
			const response = await api.verifyDomain(sessionToken, verifyRequest);

			expect(response.status).toBe(200);
			expect(response.body.status).toBe("PENDING");
		} finally {
			await deleteTestGlobalAgencyDomain(claimedDomain);
			if (userEmail) await deleteTestAgencyUser(userEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const verifyRequest: VerifyDomainRequest = {
			domain: "example.com",
		};
		const response = await api.verifyDomainWithoutAuth(verifyRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const verifyRequest: VerifyDomainRequest = {
			domain: "example.com",
		};
		const response = await api.verifyDomain(
			"ind1-" + "a".repeat(64),
			verifyRequest
		);

		expect(response.status).toBe(401);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createAgencyAdminAndGetSession(
				api,
				"agency-verify-missing"
			);
			userEmail = email;

			const response = await api.verifyDomainRaw(sessionToken, {});

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
				"agency-verify-empty"
			);
			userEmail = email;

			const response = await api.verifyDomainRaw(sessionToken, { domain: "" });

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
				"agency-verify-unclaimed"
			);
			userEmail = email;

			const verifyRequest: VerifyDomainRequest = {
				domain: "unclaimed-" + Date.now() + ".example.com",
			};
			const response = await api.verifyDomain(sessionToken, verifyRequest);

			expect(response.status).toBe(404);
		} finally {
			if (userEmail) await deleteTestAgencyUser(userEmail);
		}
	});

	test("domain owned by another agency returns 404", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		let userEmail1 = "";
		let userEmail2 = "";
		const claimedDomain = generateTestDomainName("agency-verify-owned");

		try {
			// First agency claims the domain
			const { email: email1, sessionToken: token1 } =
				await createAgencyAdminAndGetSession(api, "agency-verify-owner1");
			userEmail1 = email1;

			const claimRequest: ClaimDomainRequest = {
				domain: claimedDomain,
			};
			const claimResponse = await api.claimDomain(token1, claimRequest);
			expect(claimResponse.status).toBe(201);

			// Second agency tries to verify the domain (should fail)
			const { email: email2, sessionToken: token2 } =
				await createAgencyAdminAndGetSession(api, "agency-verify-owner2");
			userEmail2 = email2;

			const verifyRequest: VerifyDomainRequest = {
				domain: claimedDomain,
			};
			const response = await api.verifyDomain(token2, verifyRequest);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestGlobalAgencyDomain(claimedDomain);
			if (userEmail1) await deleteTestAgencyUser(userEmail1);
			if (userEmail2) await deleteTestAgencyUser(userEmail2);
		}
	});
});
