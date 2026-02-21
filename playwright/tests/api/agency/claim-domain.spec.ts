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
import type { AgencyClaimDomainRequest } from "vetchium-specs/agency-domains/agency-domains";

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

test.describe("POST /agency/claim-domain", () => {
	test("successful domain claim returns verification token", async ({
		request,
	}) => {
		const api = new AgencyAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("agency-claim-ok");

		try {
			const { email, sessionToken } = await createAgencyAdminAndGetSession(
				api,
				"agency-claim-success"
			);
			userEmail = email;

			const claimRequest: AgencyClaimDomainRequest = {
				domain: claimedDomain,
			};
			const response = await api.claimDomain(sessionToken, claimRequest);

			expect(response.status).toBe(201);
			expect(response.body.domain).toBe(claimedDomain.toLowerCase());
			expect(response.body.verification_token).toBeDefined();
			expect(response.body.verification_token).toMatch(/^[a-f0-9]{64}$/);
			expect(response.body.expires_at).toBeDefined();
			expect(response.body.instructions).toBeDefined();
		} finally {
			await deleteTestGlobalAgencyDomain(claimedDomain);
			if (userEmail) await deleteTestAgencyUser(userEmail);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const claimRequest: AgencyClaimDomainRequest = {
			domain: "example.com",
		};
		const response = await api.claimDomainWithoutAuth(claimRequest);

		expect(response.status).toBe(401);
	});

	test("invalid session token returns 401", async ({ request }) => {
		const api = new AgencyAPIClient(request);

		const claimRequest: AgencyClaimDomainRequest = {
			domain: "example.com",
		};
		const response = await api.claimDomain(
			"ind1-" + "a".repeat(64),
			claimRequest
		);

		expect(response.status).toBe(401);
	});

	test("missing domain returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createAgencyAdminAndGetSession(
				api,
				"agency-claim-missing"
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, {});

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
				"agency-claim-empty"
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, { domain: "" });

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestAgencyUser(userEmail);
		}
	});

	test("invalid domain format returns 400", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		let userEmail = "";

		try {
			const { email, sessionToken } = await createAgencyAdminAndGetSession(
				api,
				"agency-claim-invalid"
			);
			userEmail = email;

			const response = await api.claimDomainRaw(sessionToken, {
				domain: "not-a-valid-domain",
			});

			expect(response.status).toBe(400);
		} finally {
			if (userEmail) await deleteTestAgencyUser(userEmail);
		}
	});

	test("duplicate domain claim returns 409", async ({ request }) => {
		const api = new AgencyAPIClient(request);
		let userEmail = "";
		const claimedDomain = generateTestDomainName("agency-dup-claimed");

		try {
			const { email, sessionToken } = await createAgencyAdminAndGetSession(
				api,
				"agency-claim-dup"
			);
			userEmail = email;

			const claimRequest: AgencyClaimDomainRequest = {
				domain: claimedDomain,
			};

			// First claim
			const response1 = await api.claimDomain(sessionToken, claimRequest);
			expect(response1.status).toBe(201);

			// Second claim of same domain
			const response2 = await api.claimDomain(sessionToken, claimRequest);
			expect(response2.status).toBe(409);
		} finally {
			await deleteTestGlobalAgencyDomain(claimedDomain);
			if (userEmail) await deleteTestAgencyUser(userEmail);
		}
	});
});
