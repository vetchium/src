import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { PublicProfile } from "typespec/hub/profile/public";

const hubBaseURL =
  process.env.PLAYWRIGHT_HUB_BASE_URL ?? "http://hub-ui.sgp.localhost";

const profile: PublicProfile = {
  display_name: "Remote Colleague",
  handle: "remot-0123456789a",
  profile_alias: "shared-name",
  resident_country: "DE",
  biography: "Building reliable systems.",
  work_experiences: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      employer_domain: "example.com",
      job_title: "Engineer",
      start_month: "2021-01",
      location: "Berlin",
    },
  ],
  educational_qualifications: [],
  certifications: [],
  language_abilities: [{ language_tag: "de", ability: "speaking" }],
};

async function signedIn(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "vetchium.hub.session",
      JSON.stringify({
        session_token: "s".repeat(64),
        session_expires_at: new Date(Date.now() + 60_000).toISOString(),
        preferred_language: "en-US",
        resident_country: "SG",
        handle: "local-00000000001",
        remembered: false,
      }),
    );
  });
  // The portal shell reads the subscription on every page to decide whether an
  // ending entitlement needs announcing.
  await page.route("**/api/hub/my-subscription", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan_oid: "hub-free-tier",
        cancel_at_period_end: false,
      }),
    }),
  );
  await page.route("**/api/hub/my-info", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        handle: "local-00000000001",
        email_address: "local@example.com",
        display_name: "Local Viewer",
        preferred_language: "en-US",
        resident_country: "SG",
        preferred_job_countries: [],
        totp_enabled: false,
        recovery_codes_remaining: 0,
        session_authenticated_at: new Date().toISOString(),
      }),
    }),
  );
}

test("authenticated users can view a remote profile through an alias", async ({
  page,
}) => {
  await signedIn(page);
  await page.route("**/api/hub/profile/read", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ address: "shared-name" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(profile),
    });
  });
  await page.goto(`${hubBaseURL}/u/shared-name`);
  await expect(
    page.getByRole("heading", { name: "Remote Colleague" }),
  ).toBeVisible();
  await expect(page.getByText("Engineer")).toBeVisible();
  await expect(page.getByText("example.com")).toBeVisible();
  await expect(page.locator('img[src*="example.com"]')).toHaveCount(0);
  await expect(
    page.getByRole("link", {
      name: "https://vetchium.com/u/remot-0123456789a",
    }),
  ).toHaveAttribute("href", "https://vetchium.com/u/remot-0123456789a");
  await expect(
    page.getByLabel("QR code for the permanent profile link"),
  ).toBeVisible();
  await expect(page.getByText("local@example.com")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit my profile" })).toHaveCount(
    0,
  );
});

test("the owner viewing their own profile can jump to editing it", async ({
  page,
}) => {
  await signedIn(page);
  await page.route("**/api/hub/profile/read", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...profile,
        display_name: "Local Viewer",
        handle: "local-00000000001",
        profile_alias: undefined,
      }),
    }),
  );
  await page.goto(`${hubBaseURL}/u/local-00000000001`);
  await expect(
    page.getByRole("heading", { name: "Local Viewer" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit my profile" }).click();
  await expect(page).toHaveURL(`${hubBaseURL}/settings/profile`);
});

test("profile viewing requires a signed-in Hub user", async ({ page }) => {
  await page.goto(`${hubBaseURL}/u/shared-name`);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("invalid profile addresses do not trigger a profile API request", async ({
  page,
}) => {
  await signedIn(page);
  let requested = false;
  await page.route("**/api/hub/profile/read", async (route) => {
    requested = true;
    await route.abort();
  });
  await page.goto(`${hubBaseURL}/u/invalid--alias`);
  await expect(
    page.getByText("This profile address is not valid."),
  ).toBeVisible();
  expect(requested).toBe(false);
});

test("profile lookup errors are visible without exposing another profile", async ({
  page,
}) => {
  await signedIn(page);
  await page.route("**/api/hub/profile/read", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "vetchium-problem-details/hub-profile-not-found",
        title: "Hub profile not found",
        status: 404,
      }),
    }),
  );
  await page.goto(`${hubBaseURL}/u/shared-name`);
  await expect(page.getByText("This profile was not found.")).toBeVisible();
  await expect(page.getByText("Remote Colleague")).toHaveCount(0);
});

test("a remote-profile outage has a localized retry message", async ({
  page,
}) => {
  await signedIn(page);
  await page.route("**/api/hub/profile/read", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "vetchium-problem-details/hub-profile-unavailable",
        title: "Hub profile unavailable",
        status: 503,
      }),
    }),
  );
  await page.goto(`${hubBaseURL}/u/shared-name`);
  await expect(
    page.getByText("This profile is temporarily unavailable. Try again."),
  ).toBeVisible();
});
