import { test, expect } from "@playwright/test";
import { OrgAPIClient } from "../../../lib/org-api-client";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgUser,
	generateTestOrgEmail,
	assignRoleToOrgUser,
	grantMarketplaceProviderCapability,
	createTestServiceListingDirect,
	setServiceListingAppealingState,
	setServiceListingState,
	setOrgCapabilityStatus,
} from "../../../lib/db";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";

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

/** Constructs a valid CreateMarketplaceServiceListing request body */
function validListingRequest(nameSuffix: string = "1") {
	return {
		name: `Test Service Listing ${nameSuffix}`,
		short_blurb: "A short description of the test service",
		description:
			"A full description of the test service listing for Playwright tests.",
		service_category: "talent_sourcing",
		countries_of_service: ["IN"],
		contact_url: "https://example.com/contact",
		industries_served: ["technology_software"],
		company_sizes_served: ["startup"],
		job_functions_sourced: ["engineering_technology"],
		seniority_levels_sourced: ["mid"],
		geographic_sourcing_regions: ["IN"],
	};
}

test.describe("Marketplace Org API", () => {
	// ============================================================================
	// Apply for Marketplace Provider Capability
	// ============================================================================
	test.describe("POST /org/apply-marketplace-provider-capability", () => {
		test("Success: OrgUser with org:manage_marketplace can apply (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-apply");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const before = new Date(Date.now() - 2000).toISOString();
				const token = await loginOrgUser(api, email, domain);

				const res = await api.applyMarketplaceProviderCapability(token, {});
				expect(res.status).toBe(200);
				expect(res.body?.capability).toBe("marketplace_provider");
				expect(res.body?.status).toBe("pending_approval");

				// Verify audit log
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["marketplace.apply_provider_capability"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const entry = auditResp.body.audit_logs[0];
				expect(entry.event_type).toBe("marketplace.apply_provider_capability");
				expect(entry.actor_email).toBeDefined();
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: application note is optional (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-apply-note");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.applyMarketplaceProviderCapability(token, {
					application_note: "We are a professional talent sourcing firm.",
				});
				expect(res.status).toBe(200);
				expect(res.body?.status).toBe("pending_approval");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.applyMarketplaceProviderCapability(
				"invalid-token",
				{}
			);
			expect(res.status).toBe(401);
		});

		test("RBAC: user without org:manage_marketplace role (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("mkt-apply-norole");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);

			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			try {
				const token = await loginOrgUser(api, noRoleEmail, domain);
				const res = await api.applyMarketplaceProviderCapability(token, {});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Re-apply from rejected → pending_approval (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-reapply-rej");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			await setOrgCapabilityStatus(result.orgId, "rejected");

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.applyMarketplaceProviderCapability(token, {});
				expect(res.status).toBe(200);
				expect(res.body?.status).toBe("pending_approval");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Re-apply from expired → pending_approval (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-reapply-exp");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			await setOrgCapabilityStatus(result.orgId, "expired");

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.applyMarketplaceProviderCapability(token, {});
				expect(res.status).toBe(200);
				expect(res.body?.status).toBe("pending_approval");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Re-apply from revoked → pending_approval (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-reapply-rev");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			await setOrgCapabilityStatus(result.orgId, "revoked");

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.applyMarketplaceProviderCapability(token, {});
				expect(res.status).toBe(200);
				expect(res.body?.status).toBe("pending_approval");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Apply when already active → invalid state (422)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-apply-active");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			// Capability is already active

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.applyMarketplaceProviderCapability(token, {});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Apply when already pending_approval → invalid state (422)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-apply-pending");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);
			// First application via API sets pending_approval

			try {
				const token = await loginOrgUser(api, email, domain);
				// First apply
				const firstRes = await api.applyMarketplaceProviderCapability(
					token,
					{}
				);
				expect(firstRes.status).toBe(200);
				expect(firstRes.body?.status).toBe("pending_approval");
				// Try to apply again
				const secondRes = await api.applyMarketplaceProviderCapability(
					token,
					{}
				);
				expect(secondRes.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// Get Marketplace Provider Capability
	// ============================================================================
	test.describe("POST /org/get-marketplace-provider-capability", () => {
		test("Success: returns current capability status after applying (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-get-cap");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);

				// Apply first
				await api.applyMarketplaceProviderCapability(token, {});

				// Then get
				const res = await api.getMarketplaceProviderCapability(token, {});
				expect(res.status).toBe(200);
				expect(res.body?.capability).toBe("marketplace_provider");
				expect(res.body?.status).toBe("pending_approval");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: when capability doesn't exist yet (404)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-get-cap-404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.getMarketplaceProviderCapability(token, {});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.getMarketplaceProviderCapability(
				"invalid-token",
				{}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Create Service Listing
	// ============================================================================
	test.describe("POST /org/create-marketplace-service-listing", () => {
		test("Success: creates a draft listing when capability is active (201)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-create");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);

			try {
				const before = new Date(Date.now() - 2000).toISOString();
				const token = await loginOrgUser(api, email, domain);

				const res = await api.createMarketplaceServiceListing(
					token,
					validListingRequest("create")
				);
				expect(res.status).toBe(201);
				expect(res.body?.name).toBeDefined();

				// Verify audit log
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["marketplace.create_service_listing"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const entry = auditResp.body.audit_logs[0];
				expect(entry.event_type).toBe("marketplace.create_service_listing");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Forbidden: capability not active (pending_approval) (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-create-pending");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				// Apply for capability (puts it in pending_approval state)
				await api.applyMarketplaceProviderCapability(token, {});

				const res = await api.createMarketplaceServiceListing(
					token,
					validListingRequest("pending")
				);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Validation: missing required fields (400)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-create-400");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createMarketplaceServiceListing(token, {
					// Missing name, short_blurb, etc.
					contact_url: "https://example.com/contact",
				});
				expect(res.status).toBe(400);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.createMarketplaceServiceListing(
				"invalid-token",
				validListingRequest()
			);
			expect(res.status).toBe(401);
		});

		test("RBAC: user without org:manage_marketplace role (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("mkt-create-norole");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			await grantMarketplaceProviderCapability(adminResult.orgId);

			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			try {
				const token = await loginOrgUser(api, noRoleEmail, domain);
				const res = await api.createMarketplaceServiceListing(
					token,
					validListingRequest()
				);
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Quota: 21st listing rejected with conflict (409)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-quota");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);

			// Create 20 listings directly to hit quota
			for (let i = 0; i < 20; i++) {
				await createTestServiceListingDirect(
					result.orgId,
					`Quota Filler Listing ${i}`,
					"draft"
				);
			}

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.createMarketplaceServiceListing(
					token,
					validListingRequest("quota-21")
				);
				expect(res.status).toBe(409);
			} finally {
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// Submit Service Listing
	// ============================================================================
	test.describe("POST /org/submit-marketplace-service-listing", () => {
		test("Success: draft -> pending_review (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-submit");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);

			try {
				const before = new Date(Date.now() - 2000).toISOString();
				const token = await loginOrgUser(api, email, domain);

				// Create a draft listing
				const createRes = await api.createMarketplaceServiceListing(
					token,
					validListingRequest("submit")
				);
				expect(createRes.status).toBe(201);
				const listingName = createRes.body?.name;

				// Submit it
				const submitRes = await api.submitMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(submitRes.status).toBe(200);

				// Verify audit log
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["marketplace.submit_service_listing"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				expect(auditResp.body.audit_logs[0].event_type).toBe(
					"marketplace.submit_service_listing"
				);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: listing already in pending_review (422)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-submit-422");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			// Create a listing in pending_review state directly
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Already Submitted Listing",
				"pending_review"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const submitRes = await api.submitMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(submitRes.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: non-existent listing ID (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-submit-404");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.submitMarketplaceServiceListing(token, {
					name: "nonexistent-listing-name",
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.submitMarketplaceServiceListing("invalid-token", {
				name: "nonexistent-listing-name",
			});
			expect(res.status).toBe(401);
		});

		test("Rejected listing without changes cannot be submitted (422)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-submit-rej-nochange");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Rejected Listing No Changes",
				"rejected"
			);
			// changed_since_rejection is false by default

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.submitMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Rejected listing with changes can be submitted (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-submit-rej-changed");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Rejected Listing With Changes",
				"rejected"
			);

			try {
				const token = await loginOrgUser(api, email, domain);

				// Update listing to set changed_since_rejection = true
				const updateRes = await api.updateMarketplaceServiceListing(token, {
					...validListingRequest("rej-updated"),
					name: listingName,
				});
				expect(updateRes.status).toBe(200);
				expect(updateRes.body?.state).toBe("rejected");

				// Now submit should succeed
				const submitRes = await api.submitMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(submitRes.status).toBe(200);
				expect(submitRes.body?.state).toBe("pending_review");
			} finally {
				await deleteTestOrgUser(email);
			}
		});
	});

	// ============================================================================
	// Pause Service Listing
	// ============================================================================
	test.describe("POST /org/pause-marketplace-service-listing", () => {
		test("Success: active -> paused (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-pause");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Listing to Pause",
				"active"
			);

			try {
				const before = new Date(Date.now() - 2000).toISOString();
				const token = await loginOrgUser(api, email, domain);
				const res = await api.pauseMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(res.status).toBe(200);

				// Verify audit log
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["marketplace.pause_service_listing"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				expect(auditResp.body.audit_logs[0].event_type).toBe(
					"marketplace.pause_service_listing"
				);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: listing not active (422)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-pause-422");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Draft Listing Cannot Pause",
				"draft"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.pauseMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.pauseMarketplaceServiceListing("invalid-token", {
				name: "nonexistent-listing-name",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Unpause Service Listing
	// ============================================================================
	test.describe("POST /org/unpause-marketplace-service-listing", () => {
		test("Success: paused -> pending_review (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-unpause");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Listing to Unpause",
				"paused"
			);

			try {
				const before = new Date(Date.now() - 2000).toISOString();
				const token = await loginOrgUser(api, email, domain);
				const res = await api.unpauseMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(res.status).toBe(200);

				// Verify audit log
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["marketplace.unpause_service_listing"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				expect(auditResp.body.audit_logs[0].event_type).toBe(
					"marketplace.unpause_service_listing"
				);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: listing not paused (422)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-unpause-422");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Active Listing Cannot Unpause",
				"active"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.unpauseMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.unpauseMarketplaceServiceListing("invalid-token", {
				name: "nonexistent-listing-name",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Archive Service Listing
	// ============================================================================
	test.describe("POST /org/archive-marketplace-service-listing", () => {
		test("Success: active -> archived (204)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-archive");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Listing to Archive",
				"active"
			);

			try {
				const before = new Date(Date.now() - 2000).toISOString();
				const token = await loginOrgUser(api, email, domain);
				const res = await api.archiveMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(res.status).toBe(204);

				// Verify audit log
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["marketplace.archive_service_listing"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				expect(auditResp.body.audit_logs[0].event_type).toBe(
					"marketplace.archive_service_listing"
				);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: draft -> archived (204)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-archive-draft");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Draft Listing to Archive",
				"draft"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.archiveMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(res.status).toBe(204);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.archiveMarketplaceServiceListing("invalid-token", {
				name: "nonexistent-listing-name",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Submit Appeal
	// ============================================================================
	test.describe("POST /org/submit-marketplace-service-listing-appeal", () => {
		test("Success: suspended -> appealing (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-appeal");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Suspended Listing for Appeal",
				"suspended"
			);

			try {
				const before = new Date(Date.now() - 2000).toISOString();
				const token = await loginOrgUser(api, email, domain);
				const res = await api.submitMarketplaceServiceListingAppeal(token, {
					name: listingName,
					appeal_reason: "We believe this suspension was made in error.",
				});
				expect(res.status).toBe(200);

				// Verify audit log
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["marketplace.submit_service_listing_appeal"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				expect(auditResp.body.audit_logs[0].event_type).toBe(
					"marketplace.submit_service_listing_appeal"
				);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: appeal_exhausted = true (422)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-appeal-exhausted");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Appeal Exhausted Listing",
				"suspended"
			);
			// Set appeal_exhausted = true
			await setServiceListingAppealingState(listingName, true);
			// Reset back to suspended with exhausted flag
			await setServiceListingState(listingName, "suspended");

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.submitMarketplaceServiceListingAppeal(token, {
					name: listingName,
					appeal_reason: "Trying to appeal again.",
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: listing not suspended (422)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-appeal-badstate");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Active Listing Cannot Appeal",
				"active"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.submitMarketplaceServiceListingAppeal(token, {
					name: listingName,
					appeal_reason:
						"This listing is active, should not be able to appeal.",
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.submitMarketplaceServiceListingAppeal(
				"invalid-token",
				{
					name: "nonexistent-listing-name",
					appeal_reason: "Some reason",
				}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Update Service Listing
	// ============================================================================
	test.describe("POST /org/update-marketplace-service-listing", () => {
		test("Success: update draft stays draft (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-update-draft");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);

			try {
				const before = new Date(Date.now() - 2000).toISOString();
				const token = await loginOrgUser(api, email, domain);

				const createRes = await api.createMarketplaceServiceListing(
					token,
					validListingRequest("update-draft")
				);
				expect(createRes.status).toBe(201);
				const listingName = createRes.body?.name;

				const updateRes = await api.updateMarketplaceServiceListing(token, {
					...validListingRequest("updated"),
					name: listingName,
				});
				expect(updateRes.status).toBe(200);
				expect(updateRes.body?.state).toBe("draft");
				expect(updateRes.body?.name).toBe(listingName);

				// Verify audit log
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["marketplace.update_service_listing"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				expect(auditResp.body.audit_logs[0].event_type).toBe(
					"marketplace.update_service_listing"
				);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: update rejected stays rejected, sets changed_since_rejection (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-update-rejected");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Rejected Listing to Update",
				"rejected"
			);

			try {
				const token = await loginOrgUser(api, email, domain);

				const updateRes = await api.updateMarketplaceServiceListing(token, {
					...validListingRequest("rejected-updated"),
					name: listingName,
				});
				expect(updateRes.status).toBe(200);
				// Must stay rejected (NOT move to pending_review)
				expect(updateRes.body?.state).toBe("rejected");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: update active -> pending_review (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-update-active");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Active Listing to Update",
				"active"
			);

			try {
				const token = await loginOrgUser(api, email, domain);

				const updateRes = await api.updateMarketplaceServiceListing(token, {
					...validListingRequest("active-updated"),
					name: listingName,
				});
				expect(updateRes.status).toBe(200);
				// Editing an active listing moves it to pending_review immediately
				expect(updateRes.body?.state).toBe("pending_review");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: update paused -> pending_review (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-update-paused");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Paused Listing to Update",
				"paused"
			);

			try {
				const token = await loginOrgUser(api, email, domain);

				const updateRes = await api.updateMarketplaceServiceListing(token, {
					...validListingRequest("paused-updated"),
					name: listingName,
				});
				expect(updateRes.status).toBe(200);
				// Editing a paused listing moves it to pending_review immediately
				expect(updateRes.body?.state).toBe("pending_review");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: update pending_review (422)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-update-pending");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Pending Review Listing",
				"pending_review"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const updateRes = await api.updateMarketplaceServiceListing(token, {
					...validListingRequest("pending-updated"),
					name: listingName,
				});
				expect(updateRes.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Forbidden: capability not active (403)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-update-cap");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			// No capability granted — capability does not exist

			try {
				const token = await loginOrgUser(api, email, domain);
				const updateRes = await api.updateMarketplaceServiceListing(token, {
					...validListingRequest("no-cap"),
					name: "nonexistent-listing-name",
				});
				expect(updateRes.status).toBe(403);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: non-existent listing (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-update-404");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);

			try {
				const token = await loginOrgUser(api, email, domain);
				const updateRes = await api.updateMarketplaceServiceListing(token, {
					...validListingRequest("notfound"),
					name: "nonexistent-listing-name",
				});
				expect(updateRes.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.updateMarketplaceServiceListing("invalid-token", {
				...validListingRequest("unauth"),
				name: "nonexistent-listing-name",
			});
			expect(res.status).toBe(401);
		});

		test("RBAC: user without org:manage_marketplace role (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("mkt-update-norole");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			try {
				const token = await loginOrgUser(api, noRoleEmail, domain);
				const res = await api.updateMarketplaceServiceListing(token, {
					...validListingRequest("rbac"),
					name: "nonexistent-listing-name",
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});

	// ============================================================================
	// Get Service Listing (provider's own)
	// ============================================================================
	test.describe("POST /org/get-marketplace-service-listing", () => {
		test("Success: returns own listing (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-get-sl");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"My Service Listing",
				"draft"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.getMarketplaceServiceListing(token, {
					name: listingName,
				});
				expect(res.status).toBe(200);
				expect(res.body?.name).toBe("My Service Listing");
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: non-existent listing (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-get-sl-404");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.getMarketplaceServiceListing(token, {
					name: "nonexistent-listing-name",
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.getMarketplaceServiceListing("invalid-token", {
				name: "nonexistent-listing-name",
			});
			expect(res.status).toBe(401);
		});

		test("RBAC: user without org:manage_marketplace role (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("mkt-get-sl-norole");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);
			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			try {
				const token = await loginOrgUser(api, noRoleEmail, domain);
				const res = await api.getMarketplaceServiceListing(token, {
					name: "nonexistent-listing-name",
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});

	// ============================================================================
	// Get Public Service Listing (buyer view)
	// ============================================================================
	test.describe("POST /org/get-public-marketplace-service-listing", () => {
		test("Success: buyer can get active listing (200)", async ({ request }) => {
			const api = new OrgAPIClient(request);

			// Provider org
			const { email: providerEmail, domain: providerDomain } =
				generateTestOrgEmail("mkt-getpub-prov");
			const providerResult = await createTestOrgAdminDirect(
				providerEmail,
				TEST_PASSWORD
			);
			await grantMarketplaceProviderCapability(providerResult.orgId);
			const listingName = await createTestServiceListingDirect(
				providerResult.orgId,
				"Public Listing for Buyer",
				"active"
			);

			// Buyer org
			const { email: buyerEmail, domain: buyerDomain } =
				generateTestOrgEmail("mkt-getpub-buyer");
			await createTestOrgAdminDirect(buyerEmail, TEST_PASSWORD);

			try {
				const buyerToken = await loginOrgUser(api, buyerEmail, buyerDomain);
				const res = await api.getPublicMarketplaceServiceListing(buyerToken, {
					name: listingName,
					org_domain: providerDomain,
				});
				expect(res.status).toBe(200);
				expect(res.body?.name).toBe(listingName);
			} finally {
				await deleteTestOrgUser(providerEmail);
				await deleteTestOrgUser(buyerEmail);
			}
		});

		test("Forbidden: provider cannot view own listing via buyer endpoint (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-getpub-self");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Own Active Listing",
				"active"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.getPublicMarketplaceServiceListing(token, {
					name: listingName,
					org_domain: domain,
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: listing not active (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);

			// Provider org
			const { email: providerEmail, domain: providerDomain } =
				generateTestOrgEmail("mkt-getpub-notactive-prov");
			const providerResult = await createTestOrgAdminDirect(
				providerEmail,
				TEST_PASSWORD
			);
			await grantMarketplaceProviderCapability(providerResult.orgId);
			const listingName = await createTestServiceListingDirect(
				providerResult.orgId,
				"Draft Listing Not Visible",
				"draft"
			);

			// Buyer org
			const { email: buyerEmail, domain: buyerDomain } = generateTestOrgEmail(
				"mkt-getpub-notactive-buyer"
			);
			await createTestOrgAdminDirect(buyerEmail, TEST_PASSWORD);

			try {
				const buyerToken = await loginOrgUser(api, buyerEmail, buyerDomain);
				const res = await api.getPublicMarketplaceServiceListing(buyerToken, {
					name: listingName,
					org_domain: providerDomain,
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(providerEmail);
				await deleteTestOrgUser(buyerEmail);
			}
		});

		test("Not found: non-existent listing (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-getpub-missing");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.getPublicMarketplaceServiceListing(token, {
					name: "nonexistent-listing-name",
					org_domain: "nonexistent-org.test.vetchium.com",
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.getPublicMarketplaceServiceListing(
				"invalid-token",
				{
					name: "nonexistent-listing-name",
					org_domain: "nonexistent-org.test.vetchium.com",
				}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// List Service Listings
	// ============================================================================
	test.describe("POST /org/list-marketplace-service-listings", () => {
		test("Success: returns provider's own listings (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-list");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			await createTestServiceListingDirect(
				result.orgId,
				"List Test Listing 1",
				"active"
			);
			await createTestServiceListingDirect(
				result.orgId,
				"List Test Listing 2",
				"draft"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.listMarketplaceServiceListings(token, {});
				expect(res.status).toBe(200);
				expect(res.body?.service_listings).toBeDefined();
				expect(res.body?.service_listings.length).toBeGreaterThanOrEqual(2);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.listMarketplaceServiceListings("invalid-token", {});
			expect(res.status).toBe(401);
		});

		test("RBAC: user without org:manage_marketplace role (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("mkt-list-norole");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);

			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			try {
				const token = await loginOrgUser(api, noRoleEmail, domain);
				const res = await api.listMarketplaceServiceListings(token, {});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});

	// ============================================================================
	// Browse Service Listings (public, but must be authenticated org user)
	// ============================================================================
	test.describe("POST /org/browse-marketplace-service-listings", () => {
		test("Success: returns active listings from other orgs (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);

			// Org 1: the provider (has active listing)
			const { email: providerEmail, domain: providerDomain } =
				generateTestOrgEmail("mkt-browse-prov");
			const providerResult = await createTestOrgAdminDirect(
				providerEmail,
				TEST_PASSWORD
			);
			await grantMarketplaceProviderCapability(providerResult.orgId);
			await createTestServiceListingDirect(
				providerResult.orgId,
				"Browse Test Listing",
				"active"
			);

			// Org 2: the buyer (browsing)
			const { email: buyerEmail, domain: buyerDomain } =
				generateTestOrgEmail("mkt-browse-buyer");
			await createTestOrgAdminDirect(buyerEmail, TEST_PASSWORD);

			try {
				const buyerToken = await loginOrgUser(api, buyerEmail, buyerDomain);
				const res = await api.browseMarketplaceServiceListings(buyerToken, {});
				expect(res.status).toBe(200);
				expect(res.body?.service_listings).toBeDefined();
				// Should contain the provider's listing
				const providerListing = res.body?.service_listings.find(
					(l: any) => l.org_domain === providerDomain
				);
				expect(providerListing).toBeDefined();
			} finally {
				await deleteTestOrgUser(providerEmail);
				await deleteTestOrgUser(buyerEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.browseMarketplaceServiceListings(
				"invalid-token",
				{}
			);
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// Report Service Listing
	// ============================================================================
	test.describe("POST /org/report-marketplace-service-listing", () => {
		test("Success: can report another org's listing (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);

			// Provider org
			const { email: providerEmail, domain: providerDomain } =
				generateTestOrgEmail("mkt-report-prov");
			const providerResult = await createTestOrgAdminDirect(
				providerEmail,
				TEST_PASSWORD
			);
			await grantMarketplaceProviderCapability(providerResult.orgId);
			const listingName = await createTestServiceListingDirect(
				providerResult.orgId,
				"Listing to Report",
				"active"
			);

			// Reporter org
			const { email: reporterEmail, domain: reporterDomain } =
				generateTestOrgEmail("mkt-report-reporter");
			await createTestOrgAdminDirect(reporterEmail, TEST_PASSWORD);

			try {
				const before = new Date(Date.now() - 2000).toISOString();
				const reporterToken = await loginOrgUser(
					api,
					reporterEmail,
					reporterDomain
				);
				const res = await api.reportMarketplaceServiceListing(reporterToken, {
					name: listingName,
					org_domain: providerDomain,
					reason: "misleading_information",
				});
				expect(res.status).toBe(200);

				// Verify audit log
				const auditResp = await api.filterAuditLogs(reporterToken, {
					event_types: ["marketplace.report_service_listing"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const entry = auditResp.body.audit_logs[0];
				expect(entry.event_type).toBe("marketplace.report_service_listing");
			} finally {
				await deleteTestOrgUser(providerEmail);
				await deleteTestOrgUser(reporterEmail);
			}
		});

		test("Forbidden: cannot report own org's listing (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-report-own");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			await grantMarketplaceProviderCapability(result.orgId);
			const listingName = await createTestServiceListingDirect(
				result.orgId,
				"Own Listing Cannot Report",
				"active"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.reportMarketplaceServiceListing(token, {
					name: listingName,
					org_domain: domain,
					reason: "spam",
				});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Conflict: duplicate report by same user (409)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);

			// Provider org
			const { email: providerEmail, domain: providerDomain } =
				generateTestOrgEmail("mkt-report-dup-prov");
			const providerResult = await createTestOrgAdminDirect(
				providerEmail,
				TEST_PASSWORD
			);
			await grantMarketplaceProviderCapability(providerResult.orgId);
			const listingName = await createTestServiceListingDirect(
				providerResult.orgId,
				"Listing for Dup Report",
				"active"
			);

			// Reporter org
			const { email: reporterEmail, domain: reporterDomain } =
				generateTestOrgEmail("mkt-report-dup-rep");
			await createTestOrgAdminDirect(reporterEmail, TEST_PASSWORD);

			try {
				const reporterToken = await loginOrgUser(
					api,
					reporterEmail,
					reporterDomain
				);

				// First report
				const first = await api.reportMarketplaceServiceListing(reporterToken, {
					name: listingName,
					org_domain: providerDomain,
					reason: "spam",
				});
				expect(first.status).toBe(200);

				// Second report (duplicate)
				const second = await api.reportMarketplaceServiceListing(
					reporterToken,
					{
						name: listingName,
						org_domain: providerDomain,
						reason: "spam",
					}
				);
				expect(second.status).toBe(409);
			} finally {
				await deleteTestOrgUser(providerEmail);
				await deleteTestOrgUser(reporterEmail);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.reportMarketplaceServiceListing("invalid-token", {
				name: "nonexistent-listing-name",
				org_domain: "nonexistent-org.test.vetchium.com",
				reason: "spam",
			});
			expect(res.status).toBe(401);
		});
	});

	// ============================================================================
	// RBAC Tests
	// ============================================================================
	test.describe("RBAC", () => {
		test("Positive: user WITH org:manage_marketplace role can apply for capability (200)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("mkt-rbac-pos");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);

			const managerEmail = `manager@${domain}`;
			const managerResult = await createTestOrgUserDirect(
				managerEmail,
				TEST_PASSWORD,
				"ind1",
				{ orgId: adminResult.orgId, domain }
			);
			await assignRoleToOrgUser(
				managerResult.orgUserId,
				"org:manage_marketplace"
			);

			try {
				const token = await loginOrgUser(api, managerEmail, domain);
				const res = await api.applyMarketplaceProviderCapability(token, {});
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(managerEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});

		test("Negative: authenticated user with NO roles cannot apply for capability (403)", async ({
			request,
		}) => {
			const api = new OrgAPIClient(request);
			const { email: adminEmail, domain } =
				generateTestOrgEmail("mkt-rbac-neg");
			const adminResult = await createTestOrgAdminDirect(
				adminEmail,
				TEST_PASSWORD
			);

			const noRoleEmail = `norole@${domain}`;
			await createTestOrgUserDirect(noRoleEmail, TEST_PASSWORD, "ind1", {
				orgId: adminResult.orgId,
				domain,
			});

			try {
				const token = await loginOrgUser(api, noRoleEmail, domain);
				const res = await api.applyMarketplaceProviderCapability(token, {});
				expect(res.status).toBe(403);
			} finally {
				await deleteTestOrgUser(noRoleEmail);
				await deleteTestOrgUser(adminEmail);
			}
		});
	});
});
