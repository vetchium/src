import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";
import type { RequestIdRequest } from "vetchium-specs/org/references";

async function loginOrgUser(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginReq: OrgLoginRequest = {
		email,
		domain,
		password: TEST_PASSWORD,
	};
	const loginRes = await api.login(loginReq);
	expect(loginRes.status).toBe(200);

	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaReq: OrgTFARequest = {
		tfa_token: loginRes.body!.tfa_token,
		tfa_code: tfaCode,
		remember_me: true,
	};
	const tfaRes = await api.verifyTFA(tfaReq);
	expect(tfaRes.status).toBe(200);
	return tfaRes.body!.session_token;
}

/**
 * Helper function to create an org admin and return session token.
 */
async function createOrgAdminAndGetSession(
	api: OrgAPIClient,
	emailPrefix: string
): Promise<{
	email: string;
	domain: string;
	sessionToken: string;
}> {
	const { email, domain } = generateTestOrgEmail(emailPrefix);

	await createTestOrgAdminDirect(email, TEST_PASSWORD);
	const sessionToken = await loginOrgUser(api, email, domain);

	return { email, domain, sessionToken };
}

test.describe("Org References API", () => {
	test("listReferenceNominations without request_id returns 400", async ({
		request,
	}) => {
		const api = new OrgAPIClient(request);
		const { email, domain, sessionToken } = await createOrgAdminAndGetSession(
			api,
			"org-ref-list-bad"
		);

		try {
			const response = await api.listReferenceNominations(sessionToken, {
				request_id: "",
			});

			expect(response.status).toBe(400);
		} finally {
			await deleteTestOrgUser(email);
		}
	});

	test("listReferenceNominations without Authorization header returns 401", async ({
		request,
	}) => {
		const listReq: RequestIdRequest = {
			request_id: "fake-uuid",
		};
		const response = await request.post("/org/list-reference-nominations", {
			data: listReq,
		});

		expect(response.status()).toBe(401);
	});

	test("listReferenceResponses without Authorization header returns 401", async ({
		request,
	}) => {
		const listReq: RequestIdRequest = {
			request_id: "fake-uuid",
		};
		const response = await request.post("/org/list-reference-responses", {
			data: listReq,
		});

		expect(response.status()).toBe(401);
	});
});
