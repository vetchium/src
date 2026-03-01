import { test, expect } from "@playwright/test";
import { EmployerAPIClient } from "../../../lib/employer-api-client";
import {
	createTestOrgAdminDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	generateTestTagId,
	createTestTag,
	deleteTestTag,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type { GetTagRequest, FilterTagsRequest } from "vetchium-specs/employer/tags";

/**
 * Helper to perform full login flow and get session token.
 */
async function getSessionToken(
	api: EmployerAPIClient,
	email: string,
	domain: string,
	password: string
): Promise<string> {
	const loginResponse = await api.login({ email, domain, password });
	expect(loginResponse.status).toBe(200);
	const tfaToken = loginResponse.body.tfa_token;

	const tfaCode = await getTfaCodeFromEmail(email);

	const tfaResponse = await api.verifyTFA({
		tfa_token: tfaToken,
		tfa_code: tfaCode,
		remember_me: false,
	});
	expect(tfaResponse.status).toBe(200);

	return tfaResponse.body.session_token;
}

test.describe("Employer Tags API", () => {
	let sessionToken: string;
	let email: string;
	let domain: string;

	test.beforeAll(async ({ request }) => {
		const api = new EmployerAPIClient(request);
		({ email, domain } = generateTestOrgEmail("emp-tags"));
		await createTestOrgAdminDirect(email, TEST_PASSWORD);
		sessionToken = await getSessionToken(api, email, domain, TEST_PASSWORD);
	});

	test.afterAll(async () => {
		await deleteTestOrgUser(email);
	});

	// ===========================================================================
	// POST /employer/get-tag
	// ===========================================================================

	test.describe("POST /employer/get-tag", () => {
		test("returns tag for existing tag_id (200)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const tagId = generateTestTagId("empget");
			await createTestTag(tagId, [
				{
					locale: "en-US",
					display_name: "Employer Get Tag Test",
					description: "A test tag for employer get-tag",
				},
			]);
			try {
				const req: GetTagRequest = { tag_id: tagId };
				const response = await api.getTag(sessionToken, req);

				expect(response.status).toBe(200);
				expect(response.body.tag_id).toBe(tagId);
				expect(response.body.display_name).toBe("Employer Get Tag Test");
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("non-existent tag_id returns 404", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const req: GetTagRequest = { tag_id: "non-existent-emp-tag" };
			const response = await api.getTag(sessionToken, req);
			expect(response.status).toBe(404);
		});

		test("unauthenticated request returns 401", async ({ request }) => {
			const response = await request.post("/employer/get-tag", {
				data: { tag_id: "some-tag" },
			});
			expect(response.status()).toBe(401);
		});
	});

	// ===========================================================================
	// POST /employer/filter-tags
	// ===========================================================================

	test.describe("POST /employer/filter-tags", () => {
		test("returns tags with no query (200)", async ({ request }) => {
			const api = new EmployerAPIClient(request);
			const tagId1 = generateTestTagId("empflt1");
			const tagId2 = generateTestTagId("empflt2");
			await createTestTag(tagId1, [{ locale: "en-US", display_name: "Emp Filter Tag One" }]);
			await createTestTag(tagId2, [{ locale: "en-US", display_name: "Emp Filter Tag Two" }]);
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
			const api = new EmployerAPIClient(request);
			const tagId = generateTestTagId("empqry");
			await createTestTag(tagId, [
				{ locale: "en-US", display_name: "Employer Query Match Tag" },
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
			const api = new EmployerAPIClient(request);
			const req: FilterTagsRequest = {
				query: "xyzzy-emp-no-match-ever-99999",
			};
			const response = await api.filterTags(sessionToken, req);

			expect(response.status).toBe(200);
			expect(response.body.tags).toHaveLength(0);
			expect(response.body.pagination_key).toBeUndefined();
		});

		test("unauthenticated request returns 401", async ({ request }) => {
			const response = await request.post("/employer/filter-tags", {
				data: {},
			});
			expect(response.status()).toBe(401);
		});
	});

	// ===========================================================================
	// POST /employer/filter-tags pagination
	// ===========================================================================

	test.describe("POST /employer/filter-tags pagination", () => {
		let paginationTagIds: string[] = [];

		test.beforeAll(async () => {
			const base = generateTestTagId("emppg").substring(0, 10);
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
						display_name: `Emp Pagination Tag ${i}`,
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
			const api = new EmployerAPIClient(request);
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
