import { test, expect } from "@playwright/test";
import { randomUUID } from "crypto";
import { HubAPIClient } from "../../../lib/hub-api-client";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	deleteTestHubUser,
	generateTestDomainName,
	createTestApprovedDomain,
	permanentlyDeleteTestApprovedDomain,
	extractSignupTokenFromEmail,
} from "../../../lib/db";
import { waitForEmail, getEmailContent } from "../../../lib/mailpit";
import { TEST_PASSWORD } from "../../../lib/constants";
import type {
	RequestSignupRequest,
	CompleteSignupRequest,
} from "vetchium-specs/hub/hub-users";

const HUB_UI_URL = "http://localhost:3000";
const SESSION_COOKIE_NAME = "vetchium_hub_session";

async function signupHubUser(
	api: HubAPIClient,
	email: string
): Promise<{ sessionToken: string; handle: string }> {
	const reqSignup: RequestSignupRequest = { email_address: email };
	await api.requestSignup(reqSignup);

	const emailSummary = await waitForEmail(email);
	const emailMessage = await getEmailContent(emailSummary.ID);
	const signupToken = extractSignupTokenFromEmail(emailMessage);
	expect(signupToken).not.toBeNull();

	const completeReq: CompleteSignupRequest = {
		signup_token: signupToken!,
		password: TEST_PASSWORD,
		preferred_display_name: "About Tester",
		home_region: "ind1",
		preferred_language: "en-US",
		resident_country_code: "US",
	};
	const resp = await api.completeSignup(completeReq);
	expect(resp.status).toBe(201);
	return { sessionToken: resp.body.session_token, handle: resp.body.handle };
}

test.describe("Hub UI - Profile About & dark mode", () => {
	let adminEmail: string;
	let domain: string;
	let userEmail: string;

	test.beforeEach(async () => {
		adminEmail = `admin-profile-ui-${randomUUID().substring(0, 8)}@test.vetchium.com`;
		domain = generateTestDomainName("profile-ui");
		userEmail = `test-${randomUUID().substring(0, 8)}@${domain}`;
		await createTestAdminUser(adminEmail, TEST_PASSWORD);
		await createTestApprovedDomain(domain, adminEmail);
	});

	test.afterEach(async () => {
		await deleteTestHubUser(userEmail).catch(() => {});
		await permanentlyDeleteTestApprovedDomain(domain);
		await deleteTestAdminUser(adminEmail);
	});

	test("about-me set in settings shows on public profile and hero is readable in dark mode", async ({
		page,
		context,
		request,
	}) => {
		const api = new HubAPIClient(request);
		const { sessionToken, handle } = await signupHubUser(api, userEmail);

		// Authenticate the browser by setting the session cookie the app reads.
		await context.addCookies([
			{ name: SESSION_COOKIE_NAME, value: sessionToken, url: HUB_UI_URL },
		]);

		const bioText = `My about-me bio ${randomUUID().substring(0, 8)}`;

		// 1. Set "About Me" via the settings profile page.
		await page.goto(`${HUB_UI_URL}/settings/profile`);
		const aboutCard = page.locator(".ant-card").filter({
			has: page.locator(".ant-card-head-title", { hasText: /^About$/ }),
		});
		await expect(aboutCard).toBeVisible();
		// Enter edit mode via the placeholder shown when no bio exists yet.
		await aboutCard.getByText("Add a summary about yourself...").click();
		await aboutCard.locator("textarea").fill(bioText);
		await aboutCard.getByRole("button", { name: "Save", exact: true }).click();
		// After save the About card returns to read mode showing the saved bio.
		await expect(aboutCard.getByText(bioText)).toBeVisible();

		// 2. Bug #1: the About section must render on the public profile page.
		await page.goto(`${HUB_UI_URL}/u/${handle}`);
		await expect(page.getByTestId("profile-hero")).toBeVisible();
		await expect(page.getByText(bioText)).toBeVisible();

		// 3. Bug #2: in dark mode the profile hero must not keep a hardcoded white
		// background (which made the name/photo unreadable).
		await page.evaluate(() =>
			localStorage.setItem("vetchium_hub_theme", "dark")
		);
		await page.reload();
		const hero = page.getByTestId("profile-hero");
		await expect(hero).toBeVisible();
		const bg = await hero.evaluate(
			(el) => getComputedStyle(el).backgroundColor
		);
		expect(bg).not.toBe("rgb(255, 255, 255)");
	});
});
