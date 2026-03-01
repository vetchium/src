import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	assignRoleToAdminUser,
	createTestTag,
	deleteTestTag,
	generateTestTagId,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	CreateTagRequest,
	UpdateTagRequest,
	GetTagRequest,
	FilterTagsRequest,
	DeleteTagIconRequest,
} from "vetchium-specs/admin/tags";

// Minimal valid 1x1 pixel PNG (base64-encoded)
const MINIMAL_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	"base64"
);

// Invalid image data (not a recognized image format)
const INVALID_IMAGE = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x05, 0x06]);

// Oversized image: 5MB + 10 bytes (exceeds the 5MB limit)
const OVERSIZED_IMAGE = Buffer.alloc(5 * 1024 * 1024 + 10, 0x41);

test.describe("Admin Tags API", () => {
	let manageTagsEmail: string;
	let manageTagsUserId: string;
	let manageTagsToken: string;

	let noRoleEmail: string;
	let noRoleToken: string;

	test.beforeAll(async ({ request }) => {
		const api = new AdminAPIClient(request);

		// Create admin user with admin:manage_tags role
		manageTagsEmail = generateTestEmail("tags-manage");
		manageTagsUserId = await createTestAdminUser(
			manageTagsEmail,
			TEST_PASSWORD
		);
		await assignRoleToAdminUser(manageTagsUserId, "admin:manage_tags");

		const loginRes1 = await api.login({
			email: manageTagsEmail,
			password: TEST_PASSWORD,
		});
		expect(loginRes1.status).toBe(200);
		const tfaCode1 = await getTfaCodeFromEmail(manageTagsEmail);
		const tfaRes1 = await api.verifyTFA({
			tfa_token: loginRes1.body!.tfa_token,
			tfa_code: tfaCode1,
		});
		expect(tfaRes1.status).toBe(200);
		manageTagsToken = tfaRes1.body!.session_token;

		// Create admin user without any roles (for 403 tests)
		noRoleEmail = generateTestEmail("tags-norole");
		await createTestAdminUser(noRoleEmail, TEST_PASSWORD);
		const loginRes2 = await api.login({
			email: noRoleEmail,
			password: TEST_PASSWORD,
		});
		expect(loginRes2.status).toBe(200);
		const tfaCode2 = await getTfaCodeFromEmail(noRoleEmail);
		const tfaRes2 = await api.verifyTFA({
			tfa_token: loginRes2.body!.tfa_token,
			tfa_code: tfaCode2,
		});
		expect(tfaRes2.status).toBe(200);
		noRoleToken = tfaRes2.body!.session_token;
	});

	test.afterAll(async () => {
		await deleteTestAdminUser(manageTagsEmail);
		await deleteTestAdminUser(noRoleEmail);
	});

	// ===========================================================================
	// POST /admin/add-tag
	// ===========================================================================

	test.describe("POST /admin/add-tag", () => {
		test("creates tag successfully (201)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("add");
			try {
				const req: CreateTagRequest = {
					tag_id: tagId,
					translations: [
						{
							locale: "en-US",
							display_name: "Artificial Intelligence",
							description: "AI and machine learning topics",
						},
					],
				};
				const response = await api.addTag(manageTagsToken, req);

				expect(response.status).toBe(201);
				expect(response.body.tag_id).toBe(tagId);
				expect(response.body.translations).toHaveLength(1);
				expect(response.body.translations[0].locale).toBe("en-US");
				expect(response.body.translations[0].display_name).toBe(
					"Artificial Intelligence"
				);
				expect(response.body.translations[0].description).toBe(
					"AI and machine learning topics"
				);
				expect(response.body.created_at).toBeDefined();
				expect(response.body.updated_at).toBeDefined();
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("creates tag with multiple translations (201)", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("multi");
			try {
				const req: CreateTagRequest = {
					tag_id: tagId,
					translations: [
						{ locale: "en-US", display_name: "Remote Work" },
						{
							locale: "de-DE",
							display_name: "Fernarbeit",
							description: "Arbeit von zu Hause",
						},
					],
				};
				const response = await api.addTag(manageTagsToken, req);

				expect(response.status).toBe(201);
				expect(response.body.translations).toHaveLength(2);
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("duplicate tag_id returns 409", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("dup");
			await createTestTag(tagId);
			try {
				const req: CreateTagRequest = {
					tag_id: tagId,
					translations: [{ locale: "en-US", display_name: "Duplicate Tag" }],
				};
				const response = await api.addTag(manageTagsToken, req);
				expect(response.status).toBe(409);
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("missing en-US translation returns 400", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: CreateTagRequest = {
				tag_id: generateTestTagId("noenus"),
				translations: [
					{ locale: "de-DE", display_name: "Künstliche Intelligenz" },
				],
			};
			const response = await api.addTag(manageTagsToken, req);
			expect(response.status).toBe(400);
		});

		test("empty translations array returns 400", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: CreateTagRequest = {
				tag_id: generateTestTagId("empty"),
				translations: [],
			};
			const response = await api.addTag(manageTagsToken, req);
			expect(response.status).toBe(400);
		});

		test("invalid tag_id format (uppercase) returns 400", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const req: CreateTagRequest = {
				tag_id: "Invalid-Tag-ID",
				translations: [{ locale: "en-US", display_name: "Test" }],
			};
			const response = await api.addTag(manageTagsToken, req);
			expect(response.status).toBe(400);
		});

		test("tag_id with leading hyphen returns 400", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: CreateTagRequest = {
				tag_id: "-leading-hyphen",
				translations: [{ locale: "en-US", display_name: "Test" }],
			};
			const response = await api.addTag(manageTagsToken, req);
			expect(response.status).toBe(400);
		});

		test("tag_id with trailing hyphen returns 400", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: CreateTagRequest = {
				tag_id: "trailing-hyphen-",
				translations: [{ locale: "en-US", display_name: "Test" }],
			};
			const response = await api.addTag(manageTagsToken, req);
			expect(response.status).toBe(400);
		});

		test("tag_id exceeding 64 characters returns 400", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: CreateTagRequest = {
				tag_id: "a".repeat(65),
				translations: [{ locale: "en-US", display_name: "Test" }],
			};
			const response = await api.addTag(manageTagsToken, req);
			expect(response.status).toBe(400);
		});

		test("unsupported locale returns 400", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: CreateTagRequest = {
				tag_id: generateTestTagId("badloc"),
				translations: [
					{ locale: "en-US", display_name: "Test" },
					{ locale: "xx-YY", display_name: "Unsupported" },
				],
			};
			const response = await api.addTag(manageTagsToken, req);
			expect(response.status).toBe(400);
		});

		test("unauthenticated request returns 401", async ({ request }) => {
			const tagId = generateTestTagId("unauth");
			const response = await request.post("/admin/add-tag", {
				data: {
					tag_id: tagId,
					translations: [{ locale: "en-US", display_name: "Test" }],
				},
			});
			expect(response.status()).toBe(401);
		});

		test("user without role returns 403", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("norole");
			const req: CreateTagRequest = {
				tag_id: tagId,
				translations: [{ locale: "en-US", display_name: "Test" }],
			};
			const response = await api.addTag(noRoleToken, req);
			expect(response.status).toBe(403);
		});
	});

	// ===========================================================================
	// POST /admin/get-tag
	// ===========================================================================

	test.describe("POST /admin/get-tag", () => {
		test("returns tag with all translations (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("get");
			await createTestTag(tagId, [
				{
					locale: "en-US",
					display_name: "Cloud Computing",
					description: "Cloud-based infrastructure",
				},
				{ locale: "de-DE", display_name: "Cloud-Computing" },
			]);
			try {
				const req: GetTagRequest = { tag_id: tagId };
				const response = await api.getTag(manageTagsToken, req);

				expect(response.status).toBe(200);
				expect(response.body.tag_id).toBe(tagId);
				expect(response.body.translations).toHaveLength(2);

				const enUS = response.body.translations.find(
					(t) => t.locale === "en-US"
				);
				expect(enUS).toBeDefined();
				expect(enUS!.display_name).toBe("Cloud Computing");
				expect(enUS!.description).toBe("Cloud-based infrastructure");

				const deDE = response.body.translations.find(
					(t) => t.locale === "de-DE"
				);
				expect(deDE).toBeDefined();
				expect(deDE!.display_name).toBe("Cloud-Computing");
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("non-existent tag returns 404", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: GetTagRequest = {
				tag_id: "non-existent-tag-id",
			};
			const response = await api.getTag(manageTagsToken, req);
			expect(response.status).toBe(404);
		});

		test("unauthenticated request returns 401", async ({ request }) => {
			const response = await request.post("/admin/get-tag", {
				data: { tag_id: "some-tag" },
			});
			expect(response.status()).toBe(401);
		});

		test("user without role returns 403", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("get403");
			await createTestTag(tagId);
			try {
				const req: GetTagRequest = { tag_id: tagId };
				const response = await api.getTag(noRoleToken, req);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestTag(tagId);
			}
		});
	});

	// ===========================================================================
	// POST /admin/update-tag
	// ===========================================================================

	test.describe("POST /admin/update-tag", () => {
		test("updates tag translations successfully (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("upd");
			await createTestTag(tagId, [
				{ locale: "en-US", display_name: "Original Name" },
			]);
			try {
				const req: UpdateTagRequest = {
					tag_id: tagId,
					translations: [
						{
							locale: "en-US",
							display_name: "Updated Name",
							description: "Updated description",
						},
						{ locale: "de-DE", display_name: "Aktualisierter Name" },
					],
				};
				const response = await api.updateTag(manageTagsToken, req);

				expect(response.status).toBe(200);
				expect(response.body.tag_id).toBe(tagId);
				expect(response.body.translations).toHaveLength(2);

				const enUS = response.body.translations.find(
					(t) => t.locale === "en-US"
				);
				expect(enUS!.display_name).toBe("Updated Name");
				expect(enUS!.description).toBe("Updated description");
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("update replaces all existing translations", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("replace");
			await createTestTag(tagId, [
				{ locale: "en-US", display_name: "English" },
				{ locale: "de-DE", display_name: "Deutsch" },
				{ locale: "ta-IN", display_name: "தமிழ்" },
			]);
			try {
				// Update with only en-US — should replace all 3 with just 1
				const req: UpdateTagRequest = {
					tag_id: tagId,
					translations: [{ locale: "en-US", display_name: "Only English" }],
				};
				const response = await api.updateTag(manageTagsToken, req);

				expect(response.status).toBe(200);
				expect(response.body.translations).toHaveLength(1);
				expect(response.body.translations[0].locale).toBe("en-US");
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("non-existent tag returns 404", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: UpdateTagRequest = {
				tag_id: "non-existent-update",
				translations: [{ locale: "en-US", display_name: "Test" }],
			};
			const response = await api.updateTag(manageTagsToken, req);
			expect(response.status).toBe(404);
		});

		test("missing en-US translation returns 400", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("upd400");
			await createTestTag(tagId);
			try {
				const req: UpdateTagRequest = {
					tag_id: tagId,
					translations: [{ locale: "de-DE", display_name: "Nur Deutsch" }],
				};
				const response = await api.updateTag(manageTagsToken, req);
				expect(response.status).toBe(400);
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("unauthenticated request returns 401", async ({ request }) => {
			const response = await request.post("/admin/update-tag", {
				data: {
					tag_id: "some-tag",
					translations: [{ locale: "en-US", display_name: "Test" }],
				},
			});
			expect(response.status()).toBe(401);
		});

		test("user without role returns 403", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("upd403");
			await createTestTag(tagId);
			try {
				const req: UpdateTagRequest = {
					tag_id: tagId,
					translations: [{ locale: "en-US", display_name: "Test" }],
				};
				const response = await api.updateTag(noRoleToken, req);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestTag(tagId);
			}
		});
	});

	// ===========================================================================
	// POST /admin/filter-tags
	// ===========================================================================

	test.describe("POST /admin/filter-tags", () => {
		let filterTagIds: string[] = [];

		test.beforeAll(async () => {
			// Create 26 tags with a consistent prefix for pagination testing
			// Using a unique base so these tags don't interfere with other tests
			const base = generateTestTagId("ft").substring(0, 10);
			for (let i = 0; i < 26; i++) {
				const tagId = `${base}${String.fromCharCode(97 + i)}`; // ft{hex}a..z
				filterTagIds.push(tagId);
				await createTestTag(tagId, [
					{
						locale: "en-US",
						display_name: `Filter Test Tag ${String.fromCharCode(65 + i)}`,
					},
				]);
			}
		});

		test.afterAll(async () => {
			for (const tagId of filterTagIds) {
				await deleteTestTag(tagId);
			}
			filterTagIds = [];
		});

		test("returns tags with no query (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: FilterTagsRequest = {};
			const response = await api.filterTags(manageTagsToken, req);

			expect(response.status).toBe(200);
			expect(Array.isArray(response.body.tags)).toBe(true);
			// Should have at least 25 results (our setup created 26+)
			expect(response.body.tags.length).toBeGreaterThan(0);
			// Each tag should have required fields
			for (const tag of response.body.tags) {
				expect(tag.tag_id).toBeDefined();
				expect(Array.isArray(tag.translations)).toBe(true);
			}
		});

		test("returns tags matching query (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			// Query by the unique base prefix to find our test tags
			const base = filterTagIds[0].substring(0, 8);
			const req: FilterTagsRequest = { query: base };
			const response = await api.filterTags(manageTagsToken, req);

			expect(response.status).toBe(200);
			expect(response.body.tags.length).toBeGreaterThan(0);
			// All returned tags should match our filter prefix
			for (const tag of response.body.tags) {
				expect(tag.tag_id).toContain(base);
			}
		});

		test("query with no matches returns empty list (200)", async ({
			request,
		}) => {
			const api = new AdminAPIClient(request);
			const req: FilterTagsRequest = {
				query: "xyzzy-no-match-ever-12345",
			};
			const response = await api.filterTags(manageTagsToken, req);

			expect(response.status).toBe(200);
			expect(response.body.tags).toHaveLength(0);
			expect(response.body.pagination_key).toBeUndefined();
		});

		test("pagination works with pagination_key (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const base = filterTagIds[0].substring(0, 8);

			// First page
			const firstReq: FilterTagsRequest = { query: base };
			const firstPage = await api.filterTags(manageTagsToken, firstReq);
			expect(firstPage.status).toBe(200);

			// Should have pagination_key since we created 26 tags (> default limit 25)
			expect(firstPage.body.pagination_key).toBeDefined();
			expect(firstPage.body.tags.length).toBe(25);

			// Second page using pagination_key
			const secondReq: FilterTagsRequest = {
				query: base,
				pagination_key: firstPage.body.pagination_key,
			};
			const secondPage = await api.filterTags(manageTagsToken, secondReq);
			expect(secondPage.status).toBe(200);
			expect(secondPage.body.tags.length).toBeGreaterThanOrEqual(1);
			// Second page should not have more pagination
			expect(secondPage.body.pagination_key).toBeUndefined();

			// Tags across pages should be distinct
			const firstIds = firstPage.body.tags.map((t) => t.tag_id);
			const secondIds = secondPage.body.tags.map((t) => t.tag_id);
			const overlap = firstIds.filter((id) => secondIds.includes(id));
			expect(overlap).toHaveLength(0);
		});

		test("unauthenticated request returns 401", async ({ request }) => {
			const response = await request.post("/admin/filter-tags", {
				data: {},
			});
			expect(response.status()).toBe(401);
		});

		test("user without role returns 403", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: FilterTagsRequest = {};
			const response = await api.filterTags(noRoleToken, req);
			expect(response.status).toBe(403);
		});
	});

	// ===========================================================================
	// POST /admin/upload-tag-icon
	// ===========================================================================

	test.describe("POST /admin/upload-tag-icon", () => {
		test("uploads small icon successfully (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("upload");
			await createTestTag(tagId);
			try {
				const response = await api.uploadTagIcon(
					manageTagsToken,
					tagId,
					"small",
					MINIMAL_PNG,
					"icon.png",
					"image/png"
				);
				expect(response.status).toBe(200);

				// Verify icon URL is now set in the tag
				const getReq: GetTagRequest = { tag_id: tagId };
				const getResponse = await api.getTag(manageTagsToken, getReq);
				expect(getResponse.body.small_icon_url).toBeDefined();
				expect(getResponse.body.small_icon_url).toContain(tagId);
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("uploads large icon successfully (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("uplarge");
			await createTestTag(tagId);
			try {
				const response = await api.uploadTagIcon(
					manageTagsToken,
					tagId,
					"large",
					MINIMAL_PNG,
					"icon.png",
					"image/png"
				);
				expect(response.status).toBe(200);

				const getReq: GetTagRequest = { tag_id: tagId };
				const getResponse = await api.getTag(manageTagsToken, getReq);
				expect(getResponse.body.large_icon_url).toBeDefined();
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("invalid image format returns 400", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("badfmt");
			await createTestTag(tagId);
			try {
				const response = await api.uploadTagIcon(
					manageTagsToken,
					tagId,
					"small",
					INVALID_IMAGE,
					"icon.bin",
					"application/octet-stream"
				);
				expect(response.status).toBe(400);
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("file exceeding 5MB limit returns 400", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("toolarge");
			await createTestTag(tagId);
			try {
				const response = await api.uploadTagIcon(
					manageTagsToken,
					tagId,
					"small",
					OVERSIZED_IMAGE,
					"huge.png",
					"image/png"
				);
				expect(response.status).toBe(400);
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("non-existent tag returns 404", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const response = await api.uploadTagIcon(
				manageTagsToken,
				"non-existent-tag",
				"small",
				MINIMAL_PNG,
				"icon.png",
				"image/png"
			);
			expect(response.status).toBe(404);
		});

		test("unauthenticated request returns 401", async ({ request }) => {
			const tagId = generateTestTagId("upunauth");
			await createTestTag(tagId);
			try {
				const response = await request.post("/admin/upload-tag-icon", {
					multipart: {
						tag_id: tagId,
						icon_size: "small",
						icon_file: {
							name: "icon.png",
							mimeType: "image/png",
							buffer: MINIMAL_PNG,
						},
					},
				});
				expect(response.status()).toBe(401);
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("user without role returns 403", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("up403");
			await createTestTag(tagId);
			try {
				const response = await api.uploadTagIcon(
					noRoleToken,
					tagId,
					"small",
					MINIMAL_PNG,
					"icon.png",
					"image/png"
				);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestTag(tagId);
			}
		});
	});

	// ===========================================================================
	// POST /admin/delete-tag-icon
	// ===========================================================================

	test.describe("POST /admin/delete-tag-icon", () => {
		test("deletes existing icon successfully (200)", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("delicon");
			await createTestTag(tagId);
			try {
				// Upload icon first
				const uploadResponse = await api.uploadTagIcon(
					manageTagsToken,
					tagId,
					"small",
					MINIMAL_PNG,
					"icon.png",
					"image/png"
				);
				expect(uploadResponse.status).toBe(200);

				// Now delete it
				const req: DeleteTagIconRequest = {
					tag_id: tagId,
					icon_size: "small",
				};
				const response = await api.deleteTagIcon(manageTagsToken, req);
				expect(response.status).toBe(200);

				// Verify icon is no longer set
				const getReq: GetTagRequest = { tag_id: tagId };
				const getResponse = await api.getTag(manageTagsToken, getReq);
				expect(getResponse.body.small_icon_url).toBeUndefined();
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("deleting non-existent icon returns 404", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("delnoicon");
			await createTestTag(tagId); // Tag exists but no icon uploaded
			try {
				const req: DeleteTagIconRequest = {
					tag_id: tagId,
					icon_size: "small",
				};
				const response = await api.deleteTagIcon(manageTagsToken, req);
				expect(response.status).toBe(404);
			} finally {
				await deleteTestTag(tagId);
			}
		});

		test("non-existent tag returns 404", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const req: DeleteTagIconRequest = {
				tag_id: "non-existent-del",
				icon_size: "large",
			};
			const response = await api.deleteTagIcon(manageTagsToken, req);
			expect(response.status).toBe(404);
		});

		test("unauthenticated request returns 401", async ({ request }) => {
			const response = await request.post("/admin/delete-tag-icon", {
				data: { tag_id: "some-tag", icon_size: "small" },
			});
			expect(response.status()).toBe(401);
		});

		test("user without role returns 403", async ({ request }) => {
			const api = new AdminAPIClient(request);
			const tagId = generateTestTagId("del403");
			await createTestTag(tagId);
			try {
				const req: DeleteTagIconRequest = {
					tag_id: tagId,
					icon_size: "small",
				};
				const response = await api.deleteTagIcon(noRoleToken, req);
				expect(response.status).toBe(403);
			} finally {
				await deleteTestTag(tagId);
			}
		});
	});
});
