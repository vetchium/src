import { test, expect } from "@playwright/test";
import { AdminAPIClient } from "../../../lib/api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
	permanentlyDeleteTestApprovedDomain,
	getApprovedDomainAuditLogs,
	generateTestDomainName,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";

test.describe("POST /admin/approved-domains", () => {
	test("successful domain creation returns 201 with domain details", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("create-domain");
		const password = "Password123$";
		const domainName = generateTestDomainName("create");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// Create approved domain
			const response = await api.createApprovedDomain(sessionToken, domainName);

			expect(response.status).toBe(201);
			expect(response.body.domain_name).toBe(domainName.toLowerCase());
			expect(response.body.created_by_admin_email).toBe(email);
			expect(response.body.created_at).toBeDefined();

			// Verify audit log was created
			const auditLogs = await getApprovedDomainAuditLogs(domainName);
			expect(auditLogs.length).toBe(1);
			expect(auditLogs[0].action).toBe("created");
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("duplicate domain returns 409", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("duplicate-domain");
		const password = "Password123$";
		const domainName = generateTestDomainName("duplicate");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// Create domain first time
			await api.createApprovedDomain(sessionToken, domainName);

			// Try to create same domain again
			const response = await api.createApprovedDomain(sessionToken, domainName);
			expect(response.status).toBe(409);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("invalid domain name returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("invalid-domain");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// Try to create domain with invalid name
			const response = await api.createApprovedDomain(sessionToken, "not-a-domain");
			expect(response.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("missing session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const domainName = generateTestDomainName("no-auth");

		const response = await api.createApprovedDomain("", domainName);
		expect(response.status).toBe(401);
	});

	test("missing domain_name returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("missing-domain");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// Try with raw request to send empty domain_name
			const response = await request.post("/admin/approved-domains/", {
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: { domain_name: "" },
			});

			expect(response.status()).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});

test.describe("GET /admin/approved-domains", () => {
	test("list domains returns 200 with valid response structure", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("list-structure");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// List domains - note: with parallel tests, other domains may exist
			const response = await api.listApprovedDomains(sessionToken);

			expect(response.status).toBe(200);
			expect(Array.isArray(response.body.domains)).toBe(true);
			expect(typeof response.body.has_more).toBe("boolean");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("list domains returns created domains", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("list-domains");
		const password = "Password123$";
		const domainName = generateTestDomainName("list");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// Create domain
			await api.createApprovedDomain(sessionToken, domainName);

			// List domains
			const response = await api.listApprovedDomains(sessionToken);

			expect(response.status).toBe(200);
			expect(response.body.domains.length).toBeGreaterThanOrEqual(1);
			expect(
				response.body.domains.some(
					(d) => d.domain_name === domainName.toLowerCase()
				)
			).toBe(true);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("search domains finds matching results", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("search-domains");
		const password = "Password123$";
		const domainName1 = generateTestDomainName("search-test");
		const domainName2 = generateTestDomainName("other");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// Create two domains
			await api.createApprovedDomain(sessionToken, domainName1);
			await api.createApprovedDomain(sessionToken, domainName2);

			// Search for first domain
			const response = await api.listApprovedDomains(sessionToken, {
				query: domainName1.split("-")[0],
			});

			expect(response.status).toBe(200);
			expect(response.body.domains.length).toBeGreaterThanOrEqual(1);
			expect(
				response.body.domains.some(
					(d) => d.domain_name === domainName1.toLowerCase()
				)
			).toBe(true);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName1);
			await permanentlyDeleteTestApprovedDomain(domainName2);
			await deleteTestAdminUser(email);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.listApprovedDomains("");
		expect(response.status).toBe(401);
	});
});

test.describe("GET /admin/approved-domains/:domainName", () => {
	test("get domain details returns 200 with audit logs", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("get-domain");
		const password = "Password123$";
		const domainName = generateTestDomainName("get");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// Create domain
			await api.createApprovedDomain(sessionToken, domainName);

			// Get domain details
			const response = await api.getApprovedDomain(sessionToken, domainName);

			expect(response.status).toBe(200);
			expect(response.body.domain.domain_name).toBe(domainName.toLowerCase());
			expect(response.body.domain.created_by_admin_email).toBe(email);
			expect(response.body.audit_logs.length).toBe(1);
			expect(response.body.audit_logs[0].action).toBe("created");
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("get non-existent domain returns 404", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("get-404");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// Get non-existent domain
			const response = await api.getApprovedDomain(
				sessionToken,
				"nonexistent.example.com"
			);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.getApprovedDomain("", "example.com");
		expect(response.status).toBe(401);
	});
});

test.describe("DELETE /admin/approved-domains/:domainName", () => {
	test("delete domain returns 204", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("delete-domain");
		const password = "Password123$";
		const domainName = generateTestDomainName("delete");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// Create domain
			await api.createApprovedDomain(sessionToken, domainName);

			// Delete domain
			const response = await api.deleteApprovedDomain(sessionToken, domainName);

			expect(response.status).toBe(204);

			// Verify audit log was created
			const auditLogs = await getApprovedDomainAuditLogs(domainName);
			expect(auditLogs.length).toBe(2); // created + deleted
			expect(auditLogs.some((log) => log.action === "deleted")).toBe(true);

			// Verify domain is soft-deleted (should not appear in list)
			const listResponse = await api.listApprovedDomains(sessionToken);
			expect(
				listResponse.body.domains.some(
					(d) => d.domain_name === domainName.toLowerCase()
				)
			).toBe(false);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("delete non-existent domain returns 404", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("delete-404");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login(email, password);
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA(
				loginResponse.body.tfa_token,
				tfaCode
			);
			const sessionToken = tfaResponse.body.session_token;

			// Delete non-existent domain
			const response = await api.deleteApprovedDomain(
				sessionToken,
				"nonexistent.example.com"
			);

			expect(response.status).toBe(404);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.deleteApprovedDomain("", "example.com");
		expect(response.status).toBe(401);
	});
});
