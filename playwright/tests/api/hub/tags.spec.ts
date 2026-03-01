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
	generateTestTagId,
	createTestTag,
	deleteTestTag,
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
import type { GetTagRequest, FilterTagsRequest } from "vetchium-specs/hub/tags";

/**
 * Helper to perform full hub login flow and return session token.
 */
async function getHubSessionToken(
	api: HubAPIClient,
	email: string,
	password: string
): Promise<string> {
	await deleteEmailsFor(email);

	const loginRequest: HubLoginRequest = {
		email_address: email,
		password,
	};
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

/**
 * Helper function to create a test hub user through signup API.
 */
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
		preferred_display_name: "Test Hub Tags User",
		home_region: "ind1",
		preferred_language: "en-US",
		resident_country_code: "US",
	};
	await api.completeSignup(completeSignup);
}

test.describe("Hub Tags API", () => {
	let sessionToken: string;
	let hubEmail: string;
	let adminEmail: string;
	let domain: string;

	test.beforeAll(async ({ request }) => {
		const api = new HubAPIClient(request);
		adminEmail = generateTestEmail("hub-tags-admin");
		domain = generateTestDomainName();
		hubEmail = `hub-tags-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
		await createHubUserViaSignup(api, hubEmail, TEST_PASSWORD);
		sessionToken = await getHubSessionToken(api, hubEmail, TEST_PASSWORD);
	});

	test.afterAll(async () => {
		await deleteTestHubUser(hubEmail);
		await permanentlyDeleteTestApprovedDomain(domain);
		await deleteTestAdminUser(adminEmail);
	});

	// ===========================================================================
	// POST /hub/get-tag
	// ===========================================================================

	test.describe("POST /hub/get-tag", () => {
		test("returns tag for existing tag_id (200)", async ({ request }) => {
			const api = new HubAPIClient(request);
			const tagId = generateTestTagId("hubget");
			await createTestTag(tagId, [
				{
					locale: "en-US",
					display_name: "Hub Get Tag Test",
					description: "A test tag for hub get-tag",
				},
			]);
			try {
				const req: GetTagRequest = { tag_id: tagId };
				const response = await api.getTag(sessionToken, req);

				expect(response.status).toBe(200);
				expect(response.body.tag_id).toBe(tagId);
				expect(response.body.display_name).toBe("Hub Get Tag Test");
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("non-existent tag_id returns 404", async ({ request }) => {
			const api = new HubAPIClient(request);
			const req: GetTagRequest = { tag_id: "non-existent-hub-tag" };
			const response = await api.getTag(sessionToken, req);
			expect(response.status).toBe(404);
		});

		test("unauthenticated request returns 401", async ({ request }) => {
			const response = await request.post("/hub/get-tag", {
				data: { tag_id: "some-tag" },
			});
			expect(response.status()).toBe(401);
		});
	});

	// ===========================================================================
	// POST /hub/filter-tags
	// ===========================================================================

	test.describe("POST /hub/filter-tags", () => {
		test("returns tags with no query (200)", async ({ request }) => {
			const api = new HubAPIClient(request);
			const tagId1 = generateTestTagId("hubflt1");
			const tagId2 = generateTestTagId("hubflt2");
			await createTestTag(tagId1, [
				{ locale: "en-US", display_name: "Hub Filter Tag One" },
			]);
			await createTestTag(tagId2, [
				{ locale: "en-US", display_name: "Hub Filter Tag Two" },
			]);
			try {
				const req: FilterTagsRequest = {};
				const response = await api.filterTags(sessionToken, req);

				expect(response.status).toBe(200);
				expect(Array.isArray(response.body.tags)).toBe(true);
				const ids = response.body.tags.map((t) => t.tag_id);
				expect(ids).toContain(tagId1);
				expect(ids).toContain(tagId2);
			} finally {
				await deleteTestTag(tagId1);
				await deleteTestTag(tagId2);
			}
		});

		test("query match returns matching tags (200)", async ({ request }) => {
			const api = new HubAPIClient(request);
			const tagId = generateTestTagId("hubqry");
			await createTestTag(tagId, [
				{ locale: "en-US", display_name: "Hub Query Match Tag" },
			]);
			try {
				const req: FilterTagsRequest = { query: tagId };
				const response = await api.filterTags(sessionToken, req);

				expect(response.status).toBe(200);
				expect(response.body.tags.length).toBeGreaterThan(0);
				const ids = response.body.tags.map((t) => t.tag_id);
				expect(ids).toContain(tagId);
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("query with no matches returns empty list (200)", async ({
			request,
		}) => {
			const api = new HubAPIClient(request);
			const req: FilterTagsRequest = {
				query: "xyzzy-hub-no-match-ever-99999",
			};
			const response = await api.filterTags(sessionToken, req);

			expect(response.status).toBe(200);
			expect(response.body.tags).toHaveLength(0);
			expect(response.body.pagination_key).toBeUndefined();
		});

		test("unauthenticated request returns 401", async ({ request }) => {
			const response = await request.post("/hub/filter-tags", {
				data: {},
			});
			expect(response.status()).toBe(401);
		});
	});

	// ===========================================================================
	// POST /hub/filter-tags pagination
	// ===========================================================================

	test.describe("POST /hub/filter-tags pagination", () => {
		let paginationTagIds: string[] = [];

		test.beforeAll(async () => {
			const base = generateTestTagId("hubpg").substring(0, 10);
			for (let i = 0; i < 51; i++) {
				const suffix =
					i < 26
						? String.fromCharCode(97 + i)
						: `a${String.fromCharCode(97 + i - 26)}`;
				const tagId = `${base}${suffix}`;
				paginationTagIds.push(tagId);
				await createTestTag(tagId, [
					{
						locale: "en-US",
						display_name: `Hub Pagination Tag ${i}`,
					},
				]);
			}
		});

		test.afterAll(async () => {
			for (const tagId of paginationTagIds) {
				await deleteTestTag(tagId);
			}
			paginationTagIds = [];
		});

		test("pagination returns 50 items and pagination_key on first page (200)", async ({
			request,
		}) => {
			const api = new HubAPIClient(request);
			const base = paginationTagIds[0].substring(0, 8);

			const firstReq: FilterTagsRequest = { query: base };
			const firstPage = await api.filterTags(sessionToken, firstReq);
			expect(firstPage.status).toBe(200);

			// Should have pagination_key since we created 51 tags (> default limit 50)
			expect(firstPage.body.pagination_key).toBeDefined();
			expect(firstPage.body.tags.length).toBe(50);

			// Second page using pagination_key
			const secondReq: FilterTagsRequest = {
				query: base,
				pagination_key: firstPage.body.pagination_key,
			};
			const secondPage = await api.filterTags(sessionToken, secondReq);
			expect(secondPage.status).toBe(200);
			expect(secondPage.body.tags.length).toBeGreaterThanOrEqual(1);
			expect(secondPage.body.pagination_key).toBeUndefined();

			// Tags across pages should be distinct
			const firstIds = firstPage.body.tags.map((t) => t.tag_id);
			const secondIds = secondPage.body.tags.map((t) => t.tag_id);
			const overlap = firstIds.filter((id) => secondIds.includes(id));
			expect(overlap).toHaveLength(0);
		});
	});
});
