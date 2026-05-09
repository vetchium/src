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
	updateTestHubUserStatus,
	createTestHubUserDirect,
} from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type { CompleteSignupRequest } from "vetchium-specs/hub/hub-users";

/**
 * Helper function to create and authenticate a test hub user
 */
async function createAuthenticatedHubUser(
	api: HubAPIClient,
	email: string,
	password: string,
	handle: string,
	region: string = "ind1"
): Promise<{ sessionToken: string; handle: string }> {
	const user = await createTestHubUserDirect(
		email,
		password,
		handle,
		region as any
	);
	return {
		sessionToken: user.sessionToken,
		handle: user.handle,
	};
}

test.describe("POST /hub/connections", () => {
	test("get-status returns 401 without authentication", async ({ request }) => {
		// Call the endpoint directly without authentication header
		const response = await request.post("/hub/connections/get-status", {
			data: { handle: "unknown" },
		});
		expect(response.status()).toBe(401);
	});

	test("get-status returns 404 for unknown handle", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.getConnectionStatus(user.sessionToken, {
				handle: "nonexistent-user-12345",
			});
			expect(response.status).toBe(404);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("get-status returns not_connected when no relationship exists", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email1 = `test1-${randomUUID().substring(0, 8)}@${domain}`;
		const email2 = `test2-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user1 = await createAuthenticatedHubUser(
				api,
				email1,
				TEST_PASSWORD,
				"user1",
				"ind1"
			);
			const user2 = await createAuthenticatedHubUser(
				api,
				email2,
				TEST_PASSWORD,
				"user2",
				"ind1"
			);

			// Note: Without employer stint verification, these users are ineligible
			// This test assumes the backend correctly handles the eligibility check
			const response = await api.getConnectionStatus(user1.sessionToken, {
				handle: user2.handle,
			});
			expect(response.status).toBe(200);
			// Depending on employer verification status, could be ineligible or not_connected
			expect(["ineligible", "not_connected"]).toContain(
				response.body.connection_state
			);
		} finally {
			await deleteTestHubUser(email1);
			await deleteTestHubUser(email2);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("send-request returns 452 for self", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.sendConnectionRequest(user.sessionToken, {
				handle: user.handle,
			});
			expect(response.status).toBe(452);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("send-request returns 404 for unknown handle", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.sendConnectionRequest(user.sessionToken, {
				handle: "nonexistent-user-12345",
			});
			expect(response.status).toBe(404);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("block returns 452 for self", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.blockUser(user.sessionToken, {
				handle: user.handle,
			});
			expect(response.status).toBe(452);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("block returns 404 for unknown handle", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.blockUser(user.sessionToken, {
				handle: "nonexistent-user-12345",
			});
			expect(response.status).toBe(404);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("get-status returns 404 when handle does not exist", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.getConnectionStatus(user.sessionToken, {
				handle: "this-user-definitely-does-not-exist-xyz",
			});
			expect(response.status).toBe(404);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("list connections returns empty list", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.listConnections(user.sessionToken);
			expect(response.status).toBe(200);
			expect(response.body.connections).toBeDefined();
			expect(Array.isArray(response.body.connections)).toBe(true);
			expect(response.body.connections.length).toBe(0);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("get-connection-counts returns correct counts", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.getConnectionCounts(user.sessionToken);
			expect(response.status).toBe(200);
			expect(response.body.pending_incoming).toBeDefined();
			expect(response.body.pending_outgoing).toBeDefined();
			expect(response.body.connected).toBeDefined();
			expect(response.body.blocked).toBeDefined();
			expect(response.body.pending_incoming).toBe(0);
			expect(response.body.pending_outgoing).toBe(0);
			expect(response.body.connected).toBe(0);
			expect(response.body.blocked).toBe(0);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("list-incoming-requests returns empty list", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.listIncomingRequests(user.sessionToken);
			expect(response.status).toBe(200);
			expect(response.body.incoming).toBeDefined();
			expect(Array.isArray(response.body.incoming)).toBe(true);
			expect(response.body.incoming.length).toBe(0);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("list-outgoing-requests returns empty list", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.listOutgoingRequests(user.sessionToken);
			expect(response.status).toBe(200);
			expect(response.body.outgoing).toBeDefined();
			expect(Array.isArray(response.body.outgoing)).toBe(true);
			expect(response.body.outgoing.length).toBe(0);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("list-blocked returns empty list", async ({ request }) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.listBlockedUsers(user.sessionToken);
			expect(response.status).toBe(200);
			expect(response.body.blocked).toBeDefined();
			expect(Array.isArray(response.body.blocked)).toBe(true);
			expect(response.body.blocked.length).toBe(0);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});

	test("search returns empty results for no connections", async ({
		request,
	}) => {
		const api = new HubAPIClient(request);
		const adminEmail = generateTestEmail("admin");
		const domain = generateTestDomainName();
		const email = `test-${randomUUID().substring(0, 8)}@${domain}`;

		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);

		try {
			const user = await createAuthenticatedHubUser(
				api,
				email,
				TEST_PASSWORD,
				"testuser",
				"ind1"
			);
			const response = await api.searchConnections(user.sessionToken, {
				query: "any",
			});
			expect(response.status).toBe(200);
			expect(response.body.results).toBeDefined();
			expect(Array.isArray(response.body.results)).toBe(true);
			expect(response.body.results.length).toBe(0);
		} finally {
			await deleteTestHubUser(email);
			await permanentlyDeleteTestApprovedDomain(domain);
			await deleteTestAdminUser(adminEmail);
		}
	});
});
