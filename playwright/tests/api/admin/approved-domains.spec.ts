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

test.describe("POST /admin/add-approved-domain", () => {
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
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create approved domain
			const response = await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });

			expect(response.status).toBe(201);
			expect(response.body.domain_name).toBe(domainName.toLowerCase());
			expect(response.body.created_by_admin_email).toBe(email);
			expect(response.body.created_at).toBeDefined();
			expect(response.body.status).toBe("active");

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
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create domain first time
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });

			// Try to create same domain again
			const response = await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });
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
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Try to create domain with invalid name
			const response = await api.createApprovedDomain(sessionToken, { domain_name: "not-a-domain", reason: "Test domain for automated testing" });
			expect(response.status).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("missing session token returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const domainName = generateTestDomainName("no-auth");

		const response = await api.createApprovedDomain("", { domain_name: domainName, reason: "Test domain for automated testing" });
		expect(response.status).toBe(401);
	});

	test("missing domain_name returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("missing-domain");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Try with raw request to send empty domain_name
			const response = await request.post("/admin/add-approved-domain", {
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: { domain_name: "" },
			});

			expect(response.status()).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("missing reason returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("missing-reason");
		const password = "Password123$";
		const domainName = generateTestDomainName("missing-reason");

		await createTestAdminUser(email, password);
		try {
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			const response = await request.post("/admin/add-approved-domain", {
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: { domain_name: domainName, reason: "" },
			});

			expect(response.status()).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("reason longer than 256 chars returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("long-reason");
		const password = "Password123$";
		const domainName = generateTestDomainName("long-reason");

		await createTestAdminUser(email, password);
		try {
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			const longReason = "a".repeat(257);

			const response = await request.post("/admin/add-approved-domain", {
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: { domain_name: domainName, reason: longReason },
			});

			expect(response.status()).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});

test.describe("POST /admin/list-approved-domains", () => {
	test("list active domains returns 200 with valid response structure", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("list-structure");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// List active domains (default filter)
			const response = await api.listApprovedDomains(sessionToken);

			expect(response.status).toBe(200);
			expect(Array.isArray(response.body.domains)).toBe(true);
			expect(typeof response.body.has_more).toBe("boolean");
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("list domains with filter=active returns only active domains", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("list-active");
		const password = "Password123$";
		const domainName = generateTestDomainName("active");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create domain
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });

			// List active domains
			const response = await api.listApprovedDomains(sessionToken, {
				filter: "active",
			});

			expect(response.status).toBe(200);
			expect(
				response.body.domains.some(
					(d) => d.domain_name === domainName.toLowerCase()
				)
			).toBe(true);
			// All domains should have status='active'
			expect(response.body.domains.every((d) => d.status === "active")).toBe(
				true
			);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("list domains with filter=inactive returns only inactive domains", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("list-inactive");
		const password = "Password123$";
		const domainName = generateTestDomainName("inactive");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create and disable domain
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });
			await api.disableApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test disable" });

			// List inactive domains
			const response = await api.listApprovedDomains(sessionToken, {
				filter: "inactive",
			});

			expect(response.status).toBe(200);
			expect(
				response.body.domains.some(
					(d) => d.domain_name === domainName.toLowerCase()
				)
			).toBe(true);
			// All domains should have status='inactive'
			expect(response.body.domains.every((d) => d.status === "inactive")).toBe(
				true
			);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("list domains with filter=all returns both active and inactive domains", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("list-all");
		const password = "Password123$";
		const activeDomain = generateTestDomainName("all-active");
		const inactiveDomain = generateTestDomainName("all-inactive");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create two domains, disable one
			await api.createApprovedDomain(sessionToken, { domain_name: activeDomain, reason: "Test domain for automated testing" });
			await api.createApprovedDomain(sessionToken, { domain_name: inactiveDomain, reason: "Test domain for automated testing" });
			await api.disableApprovedDomain(sessionToken, { domain_name: inactiveDomain, reason: "Test disable" });

			// List all domains
			const response = await api.listApprovedDomains(sessionToken, {
				filter: "all",
			});

			expect(response.status).toBe(200);
			expect(
				response.body.domains.some(
					(d) => d.domain_name === activeDomain.toLowerCase()
				)
			).toBe(true);
			expect(
				response.body.domains.some(
					(d) => d.domain_name === inactiveDomain.toLowerCase()
				)
			).toBe(true);
		} finally {
			await permanentlyDeleteTestApprovedDomain(activeDomain);
			await permanentlyDeleteTestApprovedDomain(inactiveDomain);
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
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create two domains
			await api.createApprovedDomain(sessionToken, { domain_name: domainName1, reason: "Test domain for automated testing" });
			await api.createApprovedDomain(sessionToken, { domain_name: domainName2, reason: "Test domain for automated testing" });

			// Search for first domain
			const response = await api.listApprovedDomains(sessionToken, {
				search: domainName1.split("-")[0],
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

test.describe("POST /admin/get-approved-domain", () => {
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
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create domain
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });

			// Get domain details
			const response = await api.getApprovedDomain(sessionToken, { domain_name: domainName });

			expect(response.status).toBe(200);
			expect(response.body.domain.domain_name).toBe(domainName.toLowerCase());
			expect(response.body.domain.created_by_admin_email).toBe(email);
			expect(response.body.domain.status).toBe("active");
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
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Get non-existent domain
			const response = await api.getApprovedDomain(sessionToken, { domain_name: "nonexistent.example.com" });

			expect(response.status).toBe(404);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.getApprovedDomain("", { domain_name: "example.com" });
		expect(response.status).toBe(401);
	});

	test("missing domain_name returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("get-missing-domain");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Try with raw request to send empty domain_name
			const response = await request.post("/admin/get-approved-domain", {
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: { domain_name: "" },
			});

			expect(response.status()).toBe(400);
		} finally {
			await deleteTestAdminUser(email);
		}
	});
});

test.describe("POST /admin/disable-approved-domain", () => {
	test("disable active domain returns 200 and creates audit log", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("disable-domain");
		const password = "Password123$";
		const domainName = generateTestDomainName("disable");
		const reason = "No longer needed for testing";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create domain
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });

			// Disable domain
			const response = await api.disableApprovedDomain(sessionToken, { domain_name: domainName, reason: reason });

			expect(response.status).toBe(200);

			// Verify audit log was created
			const auditLogs = await getApprovedDomainAuditLogs(domainName);
			expect(auditLogs.length).toBe(2); // created + disabled
			expect(auditLogs.some((log) => log.action === "disabled")).toBe(true);
			const disableLog = auditLogs.find((log) => log.action === "disabled");
			expect(disableLog?.reason).toBe(reason);

			// Verify domain status changed to inactive
			const getResponse = await api.getApprovedDomain(sessionToken, { domain_name: domainName });
			expect(getResponse.body.domain.status).toBe("inactive");

			// Verify domain doesn't appear in active list
			const listResponse = await api.listApprovedDomains(sessionToken, {
				filter: "active",
			});
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

	test("disable non-existent domain returns 404", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("disable-404");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Disable non-existent domain
			const response = await api.disableApprovedDomain(sessionToken, { domain_name: "nonexistent.example.com", reason: "Test reason" });

			expect(response.status).toBe(404);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("disable already inactive domain returns 422", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("disable-422");
		const password = "Password123$";
		const domainName = generateTestDomainName("already-inactive");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create and disable domain
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });
			await api.disableApprovedDomain(sessionToken, { domain_name: domainName, reason: "First disable" });

			// Try to disable again
			const response = await api.disableApprovedDomain(sessionToken, { domain_name: domainName, reason: "Second disable" });

			expect(response.status).toBe(422);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("missing reason returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("disable-no-reason");
		const password = "Password123$";
		const domainName = generateTestDomainName("no-reason");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create domain
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });

			// Try to disable without reason
			const response = await request.post("/admin/disable-approved-domain", {
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: { domain_name: domainName, reason: "" },
			});

			expect(response.status()).toBe(400);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("reason longer than 256 chars returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("disable-long-reason");
		const password = "Password123$";
		const domainName = generateTestDomainName("long-reason");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create domain
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });

			// Try to disable with reason > 256 chars
			const longReason = "a".repeat(257);
			const response = await request.post("/admin/disable-approved-domain", {
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: { domain_name: domainName, reason: longReason },
			});

			expect(response.status()).toBe(400);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.disableApprovedDomain("", { domain_name: "example.com", reason: "Test reason" });
		expect(response.status).toBe(401);
	});
});

test.describe("POST /admin/enable-approved-domain", () => {
	test("enable inactive domain returns 200 and creates audit log", async ({
		request,
	}) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("enable-domain");
		const password = "Password123$";
		const domainName = generateTestDomainName("enable");
		const disableReason = "Temporarily disabled";
		const enableReason = "Re-enabling for production use";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create and disable domain
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });
			await api.disableApprovedDomain(sessionToken, { domain_name: domainName, reason: disableReason });

			// Enable domain
			const response = await api.enableApprovedDomain(sessionToken, { domain_name: domainName, reason: enableReason });

			expect(response.status).toBe(200);

			// Verify audit log was created
			const auditLogs = await getApprovedDomainAuditLogs(domainName);
			expect(auditLogs.length).toBe(3); // created + disabled + enabled
			expect(auditLogs.some((log) => log.action === "enabled")).toBe(true);
			const enableLog = auditLogs.find((log) => log.action === "enabled");
			expect(enableLog?.reason).toBe(enableReason);

			// Verify domain status changed to active
			const getResponse = await api.getApprovedDomain(sessionToken, { domain_name: domainName });
			expect(getResponse.body.domain.status).toBe("active");

			// Verify domain appears in active list
			const listResponse = await api.listApprovedDomains(sessionToken, {
				filter: "active",
			});
			expect(
				listResponse.body.domains.some(
					(d) => d.domain_name === domainName.toLowerCase()
				)
			).toBe(true);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("enable non-existent domain returns 404", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("enable-404");
		const password = "Password123$";

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Enable non-existent domain
			const response = await api.enableApprovedDomain(sessionToken, { domain_name: "nonexistent.example.com", reason: "Test reason" });

			expect(response.status).toBe(404);
		} finally {
			await deleteTestAdminUser(email);
		}
	});

	test("enable already active domain returns 422", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("enable-422");
		const password = "Password123$";
		const domainName = generateTestDomainName("already-active");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create domain (active by default)
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });

			// Try to enable already active domain
			const response = await api.enableApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test enable" });

			expect(response.status).toBe(422);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("missing reason returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("enable-no-reason");
		const password = "Password123$";
		const domainName = generateTestDomainName("no-reason");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create and disable domain
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });
			await api.disableApprovedDomain(sessionToken, { domain_name: domainName, reason: "Disable" });

			// Try to enable without reason
			const response = await request.post("/admin/enable-approved-domain", {
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: { domain_name: domainName, reason: "" },
			});

			expect(response.status()).toBe(400);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("reason longer than 256 chars returns 400", async ({ request }) => {
		const api = new AdminAPIClient(request);
		const email = generateTestEmail("enable-long-reason");
		const password = "Password123$";
		const domainName = generateTestDomainName("long-reason");

		await createTestAdminUser(email, password);
		try {
			// Login and get session token
			const loginResponse = await api.login({ email, password });
			const tfaCode = await getTfaCodeFromEmail(email);
			const tfaResponse = await api.verifyTFA({ tfa_token: loginResponse.body.tfa_token, tfa_code: tfaCode });
			const sessionToken = tfaResponse.body.session_token;

			// Create and disable domain
			await api.createApprovedDomain(sessionToken, { domain_name: domainName, reason: "Test domain for automated testing" });
			await api.disableApprovedDomain(sessionToken, { domain_name: domainName, reason: "Disable" });

			// Try to enable with reason > 256 chars
			const longReason = "a".repeat(257);
			const response = await request.post("/admin/enable-approved-domain", {
				headers: { Authorization: `Bearer ${sessionToken}` },
				data: { domain_name: domainName, reason: longReason },
			});

			expect(response.status()).toBe(400);
		} finally {
			await permanentlyDeleteTestApprovedDomain(domainName);
			await deleteTestAdminUser(email);
		}
	});

	test("unauthenticated request returns 401", async ({ request }) => {
		const api = new AdminAPIClient(request);

		const response = await api.enableApprovedDomain("", { domain_name: "example.com", reason: "Test reason" });
		expect(response.status).toBe(401);
	});
});
