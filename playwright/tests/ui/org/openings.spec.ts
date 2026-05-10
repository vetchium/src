import { test, expect } from "@playwright/test";
import { orgLogin, ORG_UI_URL } from "../../../lib/org-ui-helpers";
import {
	createTestOrgAdminDirect,
	createTestOrgUserDirect,
	deleteTestOrgByDomain,
	generateTestOrgEmail,
} from "../../../lib/db";
import { TEST_PASSWORD } from "../../../lib/constants";
import type { CreateOpeningRequest } from "vetchium-specs/org/openings";
import type { CreateAddressRequest } from "vetchium-specs/org/company-addresses";
import { OrgAPIClient } from "../../../lib/org-api-client";

async function loginOrgUser(
	api: OrgAPIClient,
	email: string,
	domain: string
): Promise<string> {
	const loginRes = await api.login({
		email,
		domain,
		password: TEST_PASSWORD,
	});
	const tfaCode = await (
		await fetch(`http://localhost:8080/api/messages?query=${email}`)
	).json();
	const tfaRes = await api.verifyTFA({
		tfa_token: loginRes.body!.tfa_token,
		tfa_code: tfaCode,
		remember_me: true,
	});
	return tfaRes.body!.session_token;
}

test.describe("Openings — UI", () => {
	test.describe("Openings List Page", () => {
		test("list page loads and shows empty state", async ({ page }) => {
			const { email, domain } = generateTestOrgEmail("ui-op-list-empty");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				await orgLogin(page, domain, email, TEST_PASSWORD);
				await page.goto(`${ORG_UI_URL}/openings`);
				await expect(page.locator('h2:has-text("Job Openings")')).toBeVisible();
			} finally {
				await deleteTestOrgByDomain(domain);
			}
		});

		test("back-to-dashboard button works", async ({ page }) => {
			const { email, domain } = generateTestOrgEmail("ui-op-list-back");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				await orgLogin(page, domain, email, TEST_PASSWORD);
				await page.goto(`${ORG_UI_URL}/openings`);
				await page.click('button:has-text("Back to Dashboard")');
				await expect(page).toHaveURL(`${ORG_UI_URL}/`);
			} finally {
				await deleteTestOrgByDomain(domain);
			}
		});

		test("clicking Create Opening navigates to create page", async ({
			page,
		}) => {
			const { email, domain } = generateTestOrgEmail("ui-op-list-create");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				await orgLogin(page, domain, email, TEST_PASSWORD);
				await page.goto(`${ORG_UI_URL}/openings`);
				await page.click('button:has-text("Create Opening")');
				await expect(page).toHaveURL(`${ORG_UI_URL}/openings/new`);
			} finally {
				await deleteTestOrgByDomain(domain);
			}
		});
	});

	test.describe("Create Opening Page", () => {
		test("create page renders all required fields", async ({ page }) => {
			const { email, domain } = generateTestOrgEmail("ui-op-create-render");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				await orgLogin(page, domain, email, TEST_PASSWORD);
				await page.goto(`${ORG_UI_URL}/openings/new`);
				await expect(page.locator("text=Create Opening")).toBeVisible();
				await expect(page.locator('[name="title"]')).toBeVisible();
				await expect(
					page.locator('label:has-text("Description")')
				).toBeVisible();
				await expect(
					page.locator('label:has-text("Employment Type")')
				).toBeVisible();
				await expect(
					page.locator('label:has-text("Work Location")')
				).toBeVisible();
				await expect(
					page.locator('label:has-text("Hiring Manager")')
				).toBeVisible();
				await expect(page.locator('label:has-text("Recruiter")')).toBeVisible();
			} finally {
				await deleteTestOrgByDomain(domain);
			}
		});

		test("submit with empty title shows validation error", async ({ page }) => {
			const { email, domain } = generateTestOrgEmail("ui-op-create-empty");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				await orgLogin(page, domain, email, TEST_PASSWORD);
				await page.goto(`${ORG_UI_URL}/openings/new`);
				await page.click('button[type="submit"]');
				await expect(page.locator("text=title is required")).toBeVisible();
			} finally {
				await deleteTestOrgByDomain(domain);
			}
		});

		test("back button returns to openings list", async ({ page }) => {
			const { email, domain } = generateTestOrgEmail("ui-op-create-back");
			await createTestOrgAdminDirect(email, TEST_PASSWORD);

			try {
				await orgLogin(page, domain, email, TEST_PASSWORD);
				await page.goto(`${ORG_UI_URL}/openings/new`);
				await page.click("button:has-text('Back')");
				await expect(page).toHaveURL(`${ORG_UI_URL}/openings`);
			} finally {
				await deleteTestOrgByDomain(domain);
			}
		});
	});

	test.describe("Opening Detail Page", () => {
		test.describe.configure({ mode: "serial" });

		let domain = "";
		let adminEmail = "";
		let recruiterEmail = "";
		let openingNumber = 0;
		const { email: setupAdminEmail, domain: setupDomain } =
			generateTestOrgEmail("ui-op-detail");

		test.beforeAll(async ({ request }) => {
			const api = new OrgAPIClient(request);
			const result = await createTestOrgAdminDirect(
				setupAdminEmail,
				TEST_PASSWORD
			);
			adminEmail = setupAdminEmail;
			domain = setupDomain;
			recruiterEmail = `rec@${domain}`;
			await createTestOrgUserDirect(recruiterEmail, TEST_PASSWORD, "ind1", {
				orgId: result.orgId,
				domain,
			});

			const token = await loginOrgUser(api, adminEmail, domain);

			const addrRes = await api.createAddress(token, {
				title: "HQ",
				address_line1: "1 St",
				city: "Chennai",
				country: "IN",
			} as CreateAddressRequest);

			const createRes = await api.createOpening(token, {
				title: "Detail Test Opening",
				description: "For detail page tests",
				is_internal: false,
				employment_type: "full_time",
				work_location_type: "remote",
				address_ids: [addrRes.body!.address_id],
				number_of_positions: 1,
				hiring_manager_email_address: adminEmail,
				recruiter_email_address: recruiterEmail,
			} as CreateOpeningRequest);
			openingNumber = createRes.body!.opening_number;
		});

		test.afterAll(async () => {
			await deleteTestOrgByDomain(domain);
		});

		test("detail page shows opening title and number", async ({ page }) => {
			await orgLogin(page, domain, adminEmail, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/openings/${openingNumber}`);
			await expect(page.locator("h2")).toContainText("Detail Test Opening");
			await expect(page.locator(`text=#${openingNumber}`)).toBeVisible();
		});

		test("draft status shows correct action buttons", async ({ page }) => {
			await orgLogin(page, domain, adminEmail, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/openings/${openingNumber}`);
			await expect(page.locator('button:has-text("Edit")')).toBeVisible();
			await expect(page.locator('button:has-text("Submit")')).toBeVisible();
			await expect(page.locator('button:has-text("Duplicate")')).toBeVisible();
		});

		test("Edit button navigates to edit page", async ({ page }) => {
			await orgLogin(page, domain, adminEmail, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/openings/${openingNumber}`);
			await page.click('button:has-text("Edit")');
			await expect(page).toHaveURL(
				`${ORG_UI_URL}/openings/${openingNumber}/edit`
			);
		});

		test("back to openings list button works", async ({ page }) => {
			await orgLogin(page, domain, adminEmail, TEST_PASSWORD);
			await page.goto(`${ORG_UI_URL}/openings/${openingNumber}`);
			await page.click('button:has-text("Back to Openings")');
			await expect(page).toHaveURL(`${ORG_UI_URL}/openings`);
		});
	});

	test.describe("Edit Opening Page", () => {
		test("edit page pre-fills existing opening data", async ({ page }) => {
			const { email, domain } = generateTestOrgEmail("ui-op-edit-prefill");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const recruiterEmail = `rec@${domain}`;
			await createTestOrgUserDirect(recruiterEmail, TEST_PASSWORD, "ind1", {
				orgId,
				domain,
			});

			try {
				const api = new OrgAPIClient(page.context().request);
				const token = await loginOrgUser(api, email, domain);

				const addrRes = await api.createAddress(token, {
					title: "HQ",
					address_line1: "1 St",
					city: "Chennai",
					country: "IN",
				} as CreateAddressRequest);

				const createRes = await api.createOpening(token, {
					title: "Original Title",
					description: "Original description",
					is_internal: false,
					employment_type: "full_time",
					work_location_type: "remote",
					address_ids: [addrRes.body!.address_id],
					number_of_positions: 1,
					hiring_manager_email_address: email,
					recruiter_email_address: recruiterEmail,
				} as CreateOpeningRequest);

				await orgLogin(page, domain, email, TEST_PASSWORD);
				await page.goto(
					`${ORG_UI_URL}/openings/${createRes.body!.opening_number}/edit`
				);
				await expect(page.locator('[name="title"]')).toHaveValue(
					"Original Title"
				);
				await expect(page.locator('[name="description"]')).toHaveValue(
					"Original description"
				);
			} finally {
				await deleteTestOrgByDomain(domain);
			}
		});

		test("back button returns to detail page without saving", async ({
			page,
		}) => {
			const { email, domain } = generateTestOrgEmail("ui-op-edit-back");
			const { orgId } = await createTestOrgAdminDirect(email, TEST_PASSWORD);
			const recruiterEmail = `rec@${domain}`;
			await createTestOrgUserDirect(recruiterEmail, TEST_PASSWORD, "ind1", {
				orgId,
				domain,
			});

			try {
				const api = new OrgAPIClient(page.context().request);
				const token = await loginOrgUser(api, email, domain);

				const addrRes = await api.createAddress(token, {
					title: "HQ",
					address_line1: "1 St",
					city: "Chennai",
					country: "IN",
				} as CreateAddressRequest);

				const createRes = await api.createOpening(token, {
					title: "Original Title",
					description: "Original description",
					is_internal: false,
					employment_type: "full_time",
					work_location_type: "remote",
					address_ids: [addrRes.body!.address_id],
					number_of_positions: 1,
					hiring_manager_email_address: email,
					recruiter_email_address: recruiterEmail,
				} as CreateOpeningRequest);

				await orgLogin(page, domain, email, TEST_PASSWORD);
				await page.goto(
					`${ORG_UI_URL}/openings/${createRes.body!.opening_number}/edit`
				);
				await page.fill('[name="title"]', "Abandoned Change");
				await page.click('button:has-text("Back")');
				await expect(page).toHaveURL(
					`${ORG_UI_URL}/openings/${createRes.body!.opening_number}`
				);
				await expect(page.locator("h2")).not.toContainText("Abandoned Change");
			} finally {
				await deleteTestOrgByDomain(domain);
			}
		});
	});
});
