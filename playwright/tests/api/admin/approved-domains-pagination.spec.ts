import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/admin-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	permanentlyDeleteTestApprovedDomain,
	generateTestDomainName,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sets up an authenticated admin user with session token.
 * Returns the email and session token for use in tests.
 */
async function setupAuthenticatedAdmin(
	api: AdminAPIClient,
	emailPrefix: string
): Promise<{ email: string; sessionToken: string }> {
	const email = generateTestEmail(emailPrefix);
	const password = TEST_PASSWORD;

	await createTestAdminUser(email, password);

	// Login and get session token
	const loginResponse = await api.login({ email, password });
	const tfaCode = await getTfaCodeFromEmail(email);
	const tfaResponse = await api.verifyTFA({
		tfa_token: loginResponse.body.tfa_token,
		tfa_code: tfaCode,
	});

	return {
		email,
		sessionToken: tfaResponse.body.session_token,
	};
}

/**
 * Creates multiple test domains for pagination testing.
 * Domain names use sequential suffixes for predictable alphabetical ordering.
 *
 * @param api - Admin API client
 * @param sessionToken - Session token for authentication
 * @param count - Number of domains to create
 * @param prefix - Prefix for domain names
 * @returns Array of created domain names (lowercased)
 */
async function createBulkTestDomains(
	api: AdminAPIClient,
	sessionToken: string,
	count: number,
	prefix: string
): Promise<string[]> {
	const domainNames: string[] = [];

	for (let i = 0; i < count; i++) {
		// Use sequential suffixes for predictable ordering: -00, -01, -02, etc.
		const suffix = i.toString().padStart(2, "0");
		const domainName = `${prefix}-${suffix}.example.com`;

		await api.createApprovedDomain(sessionToken, {
			domain_name: domainName,
			reason: "Test domain for pagination testing",
		});

		domainNames.push(domainName.toLowerCase());
	}

	return domainNames;
}

/**
 * Deletes multiple test domains.
 */
async function deleteBulkTestDomains(domainNames: string[]): Promise<void> {
	for (const domain of domainNames) {
		await permanentlyDeleteTestApprovedDomain(domain);
	}
}

/**
 * Generates audit logs by toggling domain status.
 * Each toggle creates 1 audit log entry (disabled or enabled).
 *
 * @param api - Admin API client
 * @param sessionToken - Session token for authentication
 * @param domainName - Domain to toggle
 * @param count - Number of audit logs to generate (minimum 1 for creation log)
 */
async function generateAuditLogs(
	api: AdminAPIClient,
	sessionToken: string,
	domainName: string,
	count: number
): Promise<void> {
	// Domain creation already generates 1 audit log ("created")
	// Generate (count - 1) more logs by toggling status
	const togglesNeeded = count - 1;

	for (let i = 0; i < togglesNeeded; i++) {
		if (i % 2 === 0) {
			// Even: disable
			await api.disableApprovedDomain(sessionToken, {
				domain_name: domainName,
				reason: `Audit log ${i + 1}`,
			});
		} else {
			// Odd: enable
			await api.enableApprovedDomain(sessionToken, {
				domain_name: domainName,
				reason: `Audit log ${i + 1}`,
			});
		}
	}
}

// ============================================================================
// Group 1: List Domains - Limit Validation (6 tests)
// ============================================================================

test.describe("POST /admin/list-approved-domains - Limit Validation", () => {
	test("zero limit returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-zero-limit"
		);

		try {
			const response = await api.listApprovedDomainsRaw(sessionToken, {
				limit: 0,
			});
			expect(response.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("negative limit returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-neg-limit"
		);

		try {
			const response = await api.listApprovedDomainsRaw(sessionToken, {
				limit: -1,
			});
			expect(response.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("limit exceeding max (101) returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-max-limit"
		);

		try {
			const response = await api.listApprovedDomainsRaw(sessionToken, {
				limit: 101,
			});
			expect(response.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("limit=1 returns single domain with has_more=true when multiple exist", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-limit-1"
		);
		const domainNames: string[] = [];

		try {
			// Create 3 domains
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				3,
				generateTestDomainName("pag-limit1")
			);
			domainNames.push(...created);

			const response = await api.listApprovedDomains(sessionToken, {
				limit: 1,
			});

			expect(response.status).toBe(200);
			expect(response.body.domains.length).toBe(1);
			expect(response.body.has_more).toBe(true);
			expect(response.body.next_cursor).toBeTruthy();
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("limit=100 is accepted (max valid)", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-limit-100"
		);

		try {
			const response = await api.listApprovedDomains(sessionToken, {
				limit: 100,
			});

			expect(response.status).toBe(200);
			expect(Array.isArray(response.body.domains)).toBe(true);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("non-numeric limit returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-non-num-limit"
		);

		try {
			const response = await api.listApprovedDomainsRaw(sessionToken, {
				limit: "abc",
			});
			expect(response.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});

// ============================================================================
// Group 2: List Domains - Cursor Navigation (9 tests)
// ============================================================================

test.describe("POST /admin/list-approved-domains - Cursor Navigation", () => {
	test("empty result set: has_more=false, next_cursor empty", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-empty"
		);

		try {
			// List with search that matches nothing
			const response = await api.listApprovedDomains(sessionToken, {
				search: "nonexistent-domain-xyz-12345",
			});

			expect(response.status).toBe(200);
			expect(response.body.domains.length).toBe(0);
			expect(response.body.has_more).toBe(false);
			expect(response.body.next_cursor).toBe("");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("single page (less than limit): has_more=false, next_cursor empty", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-single-page"
		);
		const domainNames: string[] = [];

		try {
			// Create 3 domains, request with limit=10
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				3,
				generateTestDomainName("pag-single")
			);
			domainNames.push(...created);

			const response = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				search: generateTestDomainName("pag-single").split("-")[0],
			});

			expect(response.status).toBe(200);
			expect(response.body.domains.length).toBeLessThanOrEqual(3);
			expect(response.body.has_more).toBe(false);
			expect(response.body.next_cursor).toBe("");
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("exact limit result: verify correct has_more flag", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-exact-limit"
		);
		const domainNames: string[] = [];

		try {
			// Create exactly 10 domains, request with limit=10
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				10,
				generateTestDomainName("pag-exact")
			);
			domainNames.push(...created);

			const response = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				search: generateTestDomainName("pag-exact").split("-")[0],
			});

			expect(response.status).toBe(200);
			// Should return 10 domains
			expect(response.body.domains.length).toBe(10);
			// has_more should be false (no more results)
			expect(response.body.has_more).toBe(false);
			expect(response.body.next_cursor).toBe("");
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("multiple pages - first page: has_more=true, next_cursor set", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-first-page"
		);
		const domainNames: string[] = [];

		try {
			// Create 25 domains, request with limit=10
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				25,
				generateTestDomainName("pag-first")
			);
			domainNames.push(...created);

			const response = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				search: generateTestDomainName("pag-first").split("-")[0],
			});

			expect(response.status).toBe(200);
			expect(response.body.domains.length).toBe(10);
			expect(response.body.has_more).toBe(true);
			expect(response.body.next_cursor).toBeTruthy();
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("multiple pages - middle page: different data, cursor changes", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-middle-page"
		);
		const domainNames: string[] = [];

		try {
			// Create 25 domains, navigate to page 2
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				25,
				generateTestDomainName("pag-middle")
			);
			domainNames.push(...created);

			// Get first page
			const page1 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				search: generateTestDomainName("pag-middle").split("-")[0],
			});

			expect(page1.body.has_more).toBe(true);
			expect(page1.body.next_cursor).toBeTruthy();

			// Get second page
			const page2 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				cursor: page1.body.next_cursor,
				search: generateTestDomainName("pag-middle").split("-")[0],
			});

			expect(page2.status).toBe(200);
			expect(page2.body.domains.length).toBe(10);
			expect(page2.body.has_more).toBe(true);

			// Verify no overlap between pages
			const page1Domains = page1.body.domains.map((d) => d.domain_name);
			const page2Domains = page2.body.domains.map((d) => d.domain_name);
			const overlap = page1Domains.filter((d) => page2Domains.includes(d));
			expect(overlap.length).toBe(0);

			// Verify cursor changed
			expect(page2.body.next_cursor).not.toBe(page1.body.next_cursor);
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("multiple pages - last page: has_more=false, next_cursor empty", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-last-page"
		);
		const domainNames: string[] = [];

		try {
			// Create 25 domains, navigate to last page
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				25,
				generateTestDomainName("pag-last")
			);
			domainNames.push(...created);

			const searchPrefix = generateTestDomainName("pag-last").split("-")[0];

			// Get first page
			const page1 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				search: searchPrefix,
			});

			// Get second page
			const page2 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				cursor: page1.body.next_cursor,
				search: searchPrefix,
			});

			// Get third page (last page, should have 5 domains)
			const page3 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				cursor: page2.body.next_cursor,
				search: searchPrefix,
			});

			expect(page3.status).toBe(200);
			expect(page3.body.domains.length).toBe(5);
			expect(page3.body.has_more).toBe(false);
			expect(page3.body.next_cursor).toBe("");
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("invalid cursor format returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-invalid-cursor"
		);

		try {
			const response = await api.listApprovedDomainsRaw(sessionToken, {
				cursor: "invalid-base64-cursor!@#",
			});

			expect(response.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("cursor beyond data returns empty results", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-cursor-beyond"
		);
		const domainNames: string[] = [];

		try {
			// Create 5 domains
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				5,
				generateTestDomainName("pag-beyond")
			);
			domainNames.push(...created);

			// Use a cursor that's beyond all data (base64 encoded "zzzzz.example.com")
			const beyondCursor = Buffer.from("zzzzz.example.com").toString("base64");

			const response = await api.listApprovedDomains(sessionToken, {
				cursor: beyondCursor,
			});

			expect(response.status).toBe(200);
			expect(response.body.domains.length).toBe(0);
			expect(response.body.has_more).toBe(false);
			expect(response.body.next_cursor).toBe("");
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("pagination with limit=1 navigates all items correctly", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-limit1-nav"
		);
		const domainNames: string[] = [];

		try {
			// Create 5 domains
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				5,
				generateTestDomainName("pag-nav")
			);
			domainNames.push(...created);

			const searchPrefix = generateTestDomainName("pag-nav").split("-")[0];
			const allDomains: string[] = [];
			let cursor = "";
			let hasMore = true;

			// Navigate through all pages
			while (hasMore) {
				const response = await api.listApprovedDomains(sessionToken, {
					limit: 1,
					cursor: cursor || undefined,
					search: searchPrefix,
				});

				expect(response.status).toBe(200);
				allDomains.push(...response.body.domains.map((d) => d.domain_name));

				hasMore = response.body.has_more;
				cursor = response.body.next_cursor;
			}

			// Should have retrieved all 5 domains
			expect(allDomains.length).toBe(5);
			// All domains should be unique
			expect(new Set(allDomains).size).toBe(5);
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});
});

// ============================================================================
// Group 3: List Domains - Pagination with Filters (4 tests)
// ============================================================================

test.describe("POST /admin/list-approved-domains - Pagination with Filters", () => {
	test("pagination + filter=active: only active domains across pages", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-filter-active"
		);
		const domainNames: string[] = [];

		try {
			// Create 15 active domains
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				15,
				generateTestDomainName("pag-filt-active")
			);
			domainNames.push(...created);

			const searchPrefix = generateTestDomainName(
				"pag-filt-active"
			).split("-")[0];

			// Get first page
			const page1 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				filter: "active",
				search: searchPrefix,
			});

			expect(page1.status).toBe(200);
			expect(page1.body.domains.length).toBe(10);
			expect(page1.body.domains.every((d) => d.status === "active")).toBe(true);

			// Get second page
			const page2 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				cursor: page1.body.next_cursor,
				filter: "active",
				search: searchPrefix,
			});

			expect(page2.status).toBe(200);
			expect(page2.body.domains.length).toBe(5);
			expect(page2.body.domains.every((d) => d.status === "active")).toBe(true);
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("pagination + filter=inactive: only inactive domains across pages", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-filter-inactive"
		);
		const domainNames: string[] = [];

		try {
			// Create 15 domains and disable all of them
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				15,
				generateTestDomainName("pag-filt-inactive")
			);
			domainNames.push(...created);

			// Disable all domains
			for (const domain of created) {
				await api.disableApprovedDomain(sessionToken, {
					domain_name: domain,
					reason: "Test disable",
				});
			}

			const searchPrefix = generateTestDomainName(
				"pag-filt-inactive"
			).split("-")[0];

			// Get first page
			const page1 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				filter: "inactive",
				search: searchPrefix,
			});

			expect(page1.status).toBe(200);
			expect(page1.body.domains.length).toBe(10);
			expect(page1.body.domains.every((d) => d.status === "inactive")).toBe(
				true
			);

			// Get second page
			const page2 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				cursor: page1.body.next_cursor,
				filter: "inactive",
				search: searchPrefix,
			});

			expect(page2.status).toBe(200);
			expect(page2.body.domains.length).toBe(5);
			expect(page2.body.domains.every((d) => d.status === "inactive")).toBe(
				true
			);
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("pagination + filter=all: mix of active/inactive across pages", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-filter-all"
		);
		const domainNames: string[] = [];

		try {
			// Create 20 domains
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				20,
				generateTestDomainName("pag-filt-all")
			);
			domainNames.push(...created);

			// Disable first 10 domains
			for (let i = 0; i < 10; i++) {
				await api.disableApprovedDomain(sessionToken, {
					domain_name: created[i],
					reason: "Test disable",
				});
			}

			const searchPrefix = generateTestDomainName("pag-filt-all").split("-")[0];

			// Get first page
			const page1 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				filter: "all",
				search: searchPrefix,
			});

			expect(page1.status).toBe(200);
			expect(page1.body.domains.length).toBe(10);

			// Get second page
			const page2 = await api.listApprovedDomains(sessionToken, {
				limit: 10,
				cursor: page1.body.next_cursor,
				filter: "all",
				search: searchPrefix,
			});

			expect(page2.status).toBe(200);
			expect(page2.body.domains.length).toBe(10);

			// Combine both pages and verify we have both active and inactive
			const allStatuses = [
				...page1.body.domains.map((d) => d.status),
				...page2.body.domains.map((d) => d.status),
			];
			expect(allStatuses.includes("active")).toBe(true);
			expect(allStatuses.includes("inactive")).toBe(true);
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("invalid filter value returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-invalid-filter"
		);

		try {
			const response = await api.listApprovedDomainsRaw(sessionToken, {
				filter: "invalid_filter",
			});

			expect(response.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});

// ============================================================================
// Group 4: List Domains - Pagination with Search (4 tests)
// ============================================================================

test.describe("POST /admin/list-approved-domains - Pagination with Search", () => {
	test("search with no results: has_more=false", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-search-empty"
		);

		try {
			const response = await api.listApprovedDomains(sessionToken, {
				search: "nonexistent-search-query-xyz",
			});

			expect(response.status).toBe(200);
			expect(response.body.domains.length).toBe(0);
			expect(response.body.has_more).toBe(false);
			expect(response.body.next_cursor).toBe("");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("search with single page of results", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-search-single"
		);
		const domainNames: string[] = [];

		try {
			// Create 5 domains with unique prefix
			const uniquePrefix = generateTestDomainName("pag-search-single");
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				5,
				uniquePrefix
			);
			domainNames.push(...created);

			const searchTerm = uniquePrefix.split("-")[0];
			const response = await api.listApprovedDomains(sessionToken, {
				search: searchTerm,
				limit: 10,
			});

			expect(response.status).toBe(200);
			expect(response.body.domains.length).toBe(5);
			expect(response.body.has_more).toBe(false);
			expect(response.body.next_cursor).toBe("");
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("search with multiple pages: navigate correctly", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-search-multi"
		);
		const domainNames: string[] = [];

		try {
			// Create 25 domains with unique prefix
			const uniquePrefix = generateTestDomainName("pag-search-multi");
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				25,
				uniquePrefix
			);
			domainNames.push(...created);

			const searchTerm = uniquePrefix.split("-")[0];

			// Get first page
			const page1 = await api.listApprovedDomains(sessionToken, {
				search: searchTerm,
				limit: 10,
			});

			expect(page1.status).toBe(200);
			expect(page1.body.domains.length).toBe(10);
			expect(page1.body.has_more).toBe(true);
			expect(page1.body.next_cursor).toBeTruthy();

			// Get second page
			const page2 = await api.listApprovedDomains(sessionToken, {
				search: searchTerm,
				limit: 10,
				cursor: page1.body.next_cursor,
			});

			expect(page2.status).toBe(200);
			expect(page2.body.domains.length).toBe(10);
			expect(page2.body.has_more).toBe(true);

			// Verify no overlap
			const page1Domains = page1.body.domains.map((d) => d.domain_name);
			const page2Domains = page2.body.domains.map((d) => d.domain_name);
			const overlap = page1Domains.filter((d) => page2Domains.includes(d));
			expect(overlap.length).toBe(0);
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});

	test("search + filter=active combination", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-search-filter"
		);
		const domainNames: string[] = [];

		try {
			// Create 15 domains
			const uniquePrefix = generateTestDomainName("pag-search-filter");
			const created = await createBulkTestDomains(
				api,
				sessionToken,
				15,
				uniquePrefix
			);
			domainNames.push(...created);

			// Disable first 5 domains
			for (let i = 0; i < 5; i++) {
				await api.disableApprovedDomain(sessionToken, {
					domain_name: created[i],
					reason: "Test disable",
				});
			}

			const searchTerm = uniquePrefix.split("-")[0];

			// Search with filter=active
			const response = await api.listApprovedDomains(sessionToken, {
				search: searchTerm,
				filter: "active",
				limit: 20,
			});

			expect(response.status).toBe(200);
			// Should only return 10 active domains (15 total - 5 disabled)
			expect(response.body.domains.length).toBe(10);
			expect(response.body.domains.every((d) => d.status === "active")).toBe(
				true
			);
		} finally {
			await deleteBulkTestDomains(domainNames);
			await deleteTestAdminUser(email);
		}
	});
});

// ============================================================================
// Group 5: Get Domain - Audit Log Pagination (6 tests)
// ============================================================================

test.describe("POST /admin/get-approved-domain - Audit Log Pagination", () => {
	test("audit_limit=0 returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-audit-zero"
		);
		const domainName = generateTestDomainName("pag-audit-zero");

		try {
			await api.createApprovedDomain(sessionToken, {
				domain_name: domainName,
				reason: "Test domain",
			});

			const response = await api.getApprovedDomainRaw(sessionToken, {
				domain_name: domainName,
				audit_limit: 0,
			});

			expect(response.status).toBe(400);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("audit_limit=101 returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-audit-max"
		);
		const domainName = generateTestDomainName("pag-audit-max");

		try {
			await api.createApprovedDomain(sessionToken, {
				domain_name: domainName,
				reason: "Test domain",
			});

			const response = await api.getApprovedDomainRaw(sessionToken, {
				domain_name: domainName,
				audit_limit: 101,
			});

			expect(response.status).toBe(400);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("single page of audit logs: has_more_audit=false", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-audit-single"
		);
		const domainName = generateTestDomainName("pag-audit-single");

		try {
			// Create domain (generates 1 audit log)
			await api.createApprovedDomain(sessionToken, {
				domain_name: domainName,
				reason: "Test domain",
			});

			// Generate 4 more audit logs (total 5)
			await generateAuditLogs(api, sessionToken, domainName, 5);

			// Request with limit=10
			const response = await api.getApprovedDomain(sessionToken, {
				domain_name: domainName,
				audit_limit: 10,
			});

			expect(response.status).toBe(200);
			expect(response.body.audit_logs.length).toBe(5);
			expect(response.body.has_more_audit).toBe(false);
			expect(response.body.next_audit_cursor).toBe("");
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("multiple pages of audit logs: navigate correctly", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-audit-multi"
		);
		const domainName = generateTestDomainName("pag-audit-multi");

		try {
			// Create domain (generates 1 audit log)
			await api.createApprovedDomain(sessionToken, {
				domain_name: domainName,
				reason: "Test domain",
			});

			// Generate 24 more audit logs (total 25)
			await generateAuditLogs(api, sessionToken, domainName, 25);

			// Get first page
			const page1 = await api.getApprovedDomain(sessionToken, {
				domain_name: domainName,
				audit_limit: 10,
			});

			expect(page1.status).toBe(200);
			expect(page1.body.audit_logs.length).toBe(10);
			expect(page1.body.has_more_audit).toBe(true);
			expect(page1.body.next_audit_cursor).toBeTruthy();

			// Get second page
			const page2 = await api.getApprovedDomain(sessionToken, {
				domain_name: domainName,
				audit_limit: 10,
				audit_cursor: page1.body.next_audit_cursor,
			});

			expect(page2.status).toBe(200);
			expect(page2.body.audit_logs.length).toBe(10);
			expect(page2.body.has_more_audit).toBe(true);

			// Get third page (last 5)
			const page3 = await api.getApprovedDomain(sessionToken, {
				domain_name: domainName,
				audit_limit: 10,
				audit_cursor: page2.body.next_audit_cursor,
			});

			expect(page3.status).toBe(200);
			expect(page3.body.audit_logs.length).toBe(5);
			expect(page3.body.has_more_audit).toBe(false);
			expect(page3.body.next_audit_cursor).toBe("");
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("invalid audit_cursor returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-audit-invalid-cursor"
		);
		const domainName = generateTestDomainName("pag-audit-invalid");

		try {
			await api.createApprovedDomain(sessionToken, {
				domain_name: domainName,
				reason: "Test domain",
			});

			const response = await api.getApprovedDomainRaw(sessionToken, {
				domain_name: domainName,
				audit_cursor: "invalid-cursor!@#",
			});

			expect(response.status).toBe(400);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("audit_limit=1 navigates through all logs", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const { email, sessionToken } = await setupAuthenticatedAdmin(
			api,
			"pag-audit-limit1"
		);
		const domainName = generateTestDomainName("pag-audit-limit1");

		try {
			// Create domain (generates 1 audit log)
			await api.createApprovedDomain(sessionToken, {
				domain_name: domainName,
				reason: "Test domain",
			});

			// Generate 4 more audit logs (total 5)
			await generateAuditLogs(api, sessionToken, domainName, 5);

			// Navigate through all audit logs one by one
			const allAuditLogs: string[] = [];
			let cursor = "";
			let hasMore = true;

			while (hasMore) {
				const response = await api.getApprovedDomain(sessionToken, {
					domain_name: domainName,
					audit_limit: 1,
					audit_cursor: cursor || undefined,
				});

				expect(response.status).toBe(200);
				expect(response.body.audit_logs.length).toBe(1);

				allAuditLogs.push(response.body.audit_logs[0].action);

				hasMore = response.body.has_more_audit;
				cursor = response.body.next_audit_cursor;
			}

			// Should have retrieved all 5 audit logs
			expect(allAuditLogs.length).toBe(5);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});
});
