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
		geographic_sourcing_regions: ["India"],
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
				expect(res.body?.org_id).toBe(result.orgId);

				// Verify audit log
				const auditResp = await api.filterAuditLogs(token, {
					event_types: ["marketplace.apply_provider_capability"],
					start_time: before,
				});
				expect(auditResp.status).toBe(200);
				expect(auditResp.body.audit_logs.length).toBeGreaterThanOrEqual(1);
				const entry = auditResp.body.audit_logs[0];
				expect(entry.event_type).toBe("marketplace.apply_provider_capability");
				expect(entry.actor_user_id).toBeDefined();
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
				expect(res.body?.service_listing_id).toBeDefined();

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
				const token = await loginOrgUser(api, email, domain);

				// Create a draft listing
				const createRes = await api.createMarketplaceServiceListing(
					token,
					validListingRequest("submit")
				);
				expect(createRes.status).toBe(201);
				const listingId = createRes.body?.service_listing_id;

				// Submit it
				const submitRes = await api.submitMarketplaceServiceListing(token, {
					service_listing_id: listingId,
				});
				expect(submitRes.status).toBe(200);
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
			// Create a listing in pending_review state directly
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Already Submitted Listing",
				"pending_review"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const submitRes = await api.submitMarketplaceServiceListing(token, {
					service_listing_id: listingId,
				});
				expect(submitRes.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Not found: non-existent listing ID (404)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-submit-404");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.submitMarketplaceServiceListing(token, {
					service_listing_id: "00000000-0000-0000-0000-000000000000",
				});
				expect(res.status).toBe(404);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.submitMarketplaceServiceListing("invalid-token", {
				service_listing_id: "00000000-0000-0000-0000-000000000000",
			});
			expect(res.status).toBe(401);
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
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Listing to Pause",
				"active"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.pauseMarketplaceServiceListing(token, {
					service_listing_id: listingId,
				});
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: listing not active (422)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-pause-422");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Draft Listing Cannot Pause",
				"draft"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.pauseMarketplaceServiceListing(token, {
					service_listing_id: listingId,
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.pauseMarketplaceServiceListing("invalid-token", {
				service_listing_id: "00000000-0000-0000-0000-000000000000",
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
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Listing to Unpause",
				"paused"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.unpauseMarketplaceServiceListing(token, {
					service_listing_id: listingId,
				});
				expect(res.status).toBe(200);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Invalid state: listing not paused (422)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-unpause-422");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Active Listing Cannot Unpause",
				"active"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.unpauseMarketplaceServiceListing(token, {
					service_listing_id: listingId,
				});
				expect(res.status).toBe(422);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.unpauseMarketplaceServiceListing("invalid-token", {
				service_listing_id: "00000000-0000-0000-0000-000000000000",
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
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Listing to Archive",
				"active"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.archiveMarketplaceServiceListing(token, {
					service_listing_id: listingId,
				});
				expect(res.status).toBe(204);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Success: draft -> archived (204)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const { email, domain } = generateTestOrgEmail("mkt-archive-draft");
			const result = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Draft Listing to Archive",
				"draft"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.archiveMarketplaceServiceListing(token, {
					service_listing_id: listingId,
				});
				expect(res.status).toBe(204);
			} finally {
				await deleteTestOrgUser(email);
			}
		});

		test("Auth: unauthenticated (401)", async ({ request }) => {
			const api = new OrgAPIClient(request);
			const res = await api.archiveMarketplaceServiceListing("invalid-token", {
				service_listing_id: "00000000-0000-0000-0000-000000000000",
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
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Suspended Listing for Appeal",
				"suspended"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.submitMarketplaceServiceListingAppeal(token, {
					service_listing_id: listingId,
					appeal_reason: "We believe this suspension was made in error.",
				});
				expect(res.status).toBe(200);
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
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Appeal Exhausted Listing",
				"suspended"
			);
			// Set appeal_exhausted = true
			await setServiceListingAppealingState(listingId, true);
			// Reset back to suspended with exhausted flag
			await setServiceListingState(listingId, "suspended");

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.submitMarketplaceServiceListingAppeal(token, {
					service_listing_id: listingId,
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
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Active Listing Cannot Appeal",
				"active"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.submitMarketplaceServiceListingAppeal(token, {
					service_listing_id: listingId,
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
					service_listing_id: "00000000-0000-0000-0000-000000000000",
					appeal_reason: "Some reason",
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
					(l: any) => l.org_id === providerResult.orgId
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
			const listingId = await createTestServiceListingDirect(
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
					service_listing_id: listingId,
					home_region: "ind1",
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
			const listingId = await createTestServiceListingDirect(
				result.orgId,
				"Own Listing Cannot Report",
				"active"
			);

			try {
				const token = await loginOrgUser(api, email, domain);
				const res = await api.reportMarketplaceServiceListing(token, {
					service_listing_id: listingId,
					home_region: "ind1",
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
			const { email: providerEmail } = generateTestOrgEmail(
				"mkt-report-dup-prov"
			);
			const providerResult = await createTestOrgAdminDirect(
				providerEmail,
				TEST_PASSWORD
			);
			await grantMarketplaceProviderCapability(providerResult.orgId);
			const listingId = await createTestServiceListingDirect(
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
					service_listing_id: listingId,
					home_region: "ind1",
					reason: "spam",
				});
				expect(first.status).toBe(200);

				// Second report (duplicate)
				const second = await api.reportMarketplaceServiceListing(
					reporterToken,
					{
						service_listing_id: listingId,
						home_region: "ind1",
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
				service_listing_id: "00000000-0000-0000-0000-000000000000",
				home_region: "ind1",
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
