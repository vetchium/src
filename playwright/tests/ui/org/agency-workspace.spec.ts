import { test, expect } from "@playwright/test";
import { orgLogin, ORG_UI_URL } from "../../../lib/org-ui-helpers";
import { OrgAPIClient } from "../../../lib/org-api-client";
import { getTfaCodeFromEmail } from "../../../lib/mailpit";
import {
	createTestOrgAdminDirect,
	createTestHubUserDirect,
	createTestMarketplaceListingDirect,
	createTestMarketplaceSubscriptionDirect,
	createTestOpeningDirect,
	deleteTestOrgByDomain,
	deleteTestHubUser,
	generateTestOrgEmail,
	generateTestEmail,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	OrgLoginRequest,
	OrgTFARequest,
} from "vetchium-specs/org/org-users";

// Drives the redesigned agency workspace end to end: a lead sees the openings
// their agency staffs, opens one, and refers a candidate via the modal.
test.describe("Org UI — Agency Workspace", () => {
	test("lead browses assigned openings, opens one, and refers a candidate", async ({
		page,
		playwright,
	}) => {
		const { email: consumerEmail, domain: consumerDomain } =
			generateTestOrgEmail("agws-consumer");
		const { email: agencyEmail, domain: agencyDomain } =
			generateTestOrgEmail("agws-agency");
		const candidateEmail = generateTestEmail("agws-cand");

		try {
			const consumer = await createTestOrgAdminDirect(
				consumerEmail,
				TEST_PASSWORD
			);
			const agency = await createTestOrgAdminDirect(agencyEmail, TEST_PASSWORD);

			const listing = await createTestMarketplaceListingDirect(
				agency.orgId,
				agencyDomain,
				["staffing"],
				"active"
			);
			await createTestMarketplaceSubscriptionDirect(
				consumer.orgId,
				"ind1",
				agency.orgId,
				"ind1",
				listing.listingId
			);
			const opening = await createTestOpeningDirect(
				consumer.orgId,
				consumer.orgUserId,
				"Platform Engineer"
			);
			const candidate = await createTestHubUserDirect(
				candidateEmail,
				TEST_PASSWORD,
				"agws-cand"
			);

			// Consumer assigns the agency to the opening (via API).
			const request = await playwright.request.newContext({
				baseURL: "http://localhost:8080",
			});
			const api = new OrgAPIClient(request);
			const loginRes = await api.login({
				email: consumerEmail,
				domain: consumerDomain,
				password: TEST_PASSWORD,
			} as OrgLoginRequest);
			const tfaCode = await getTfaCodeFromEmail(consumerEmail);
			const tfaRes = await api.verifyTFA({
				tfa_token: loginRes.body!.tfa_token,
				tfa_code: tfaCode,
				remember_me: false,
			} as OrgTFARequest);
			const consumerToken = tfaRes.body!.session_token;
			const assignRes = await request.post("/org/assign-opening-agency", {
				headers: { Authorization: `Bearer ${consumerToken}` },
				data: {
					opening_id: opening.openingId,
					agency_org_domain: agencyDomain,
				},
			});
			expect(assignRes.status()).toBe(200);
			await request.dispose();

			// Agency lead drives the UI.
			await orgLogin(page, agencyDomain, agencyEmail, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/referrals`);

			// Workspace lists the assigned opening under the client domain.
			await expect(page.locator("text=Platform Engineer").first()).toBeVisible({
				timeout: 10000,
			});
			await expect(
				page.locator(`text=${consumerDomain}`).first()
			).toBeVisible();

			// Open the opening detail.
			await page.locator("a:has-text('Open')").first().click();
			await expect(
				page.locator("button:has-text('Refer Candidate')")
			).toBeVisible({ timeout: 10000 });

			// Refer the candidate through the modal.
			await page.locator("button:has-text('Refer Candidate')").click();
			await page.fill('input[placeholder="handle"]', candidate.handle);
			await page.locator(".ant-modal button:has-text('Refer')").click();

			// The referral appears in the opening's referrals table.
			await expect(page.locator(`text=${candidate.handle}`)).toBeVisible({
				timeout: 10000,
			});
		} finally {
			await deleteTestHubUser(candidateEmail).catch(() => {});
			await deleteTestOrgByDomain(consumerDomain).catch(() => {});
			await deleteTestOrgByDomain(agencyDomain).catch(() => {});
		}
	});
});
