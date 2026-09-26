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
  websites: [
    {
      id: "00000000-0000-4000-8000-0000000000a1",
      url: "https://github.com/remote-colleague",
    },
    {
      id: "00000000-0000-4000-8000-0000000000a2",
      url: "https://www.linkedin.com/in/remote-colleague",
    },
    {
      id: "00000000-0000-4000-8000-0000000000a3",
      url: "https://x.com/remote_colleague",
    },
    {
      id: "00000000-0000-4000-8000-0000000000a4",
      url: "https://remote-colleague.example.dev/blog",
    },
  ],
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
  await page.getByRole("button", { name: "Share profile" }).click();
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

test("a very long display name wraps inside the header instead of breaking the layout", async ({
  page,
}) => {
  const longName = `${"Wolfeschlegelsteinhausenbergerdorff ".repeat(3)}${"x".repeat(80)}`;
  await signedIn(page);
  await page.route("**/api/hub/profile/read", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...profile, display_name: longName }),
    }),
  );
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${hubBaseURL}/u/shared-name`);
    const heading = page.getByRole("heading", { name: longName });
    await expect(heading).toBeVisible();
    const share = page.getByRole("button", { name: "Share profile" });
    await expect(share).toBeVisible();
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    // The QR code no longer claims its own column, so nothing may scroll
    // the page sideways.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test("a profile without a picture shows the display name initial as the avatar", async ({
  page,
}) => {
  await signedIn(page);
  const show = (displayName: string, pictureURL?: string) =>
    page.route("**/api/hub/profile/read", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...profile,
          display_name: displayName,
          profile_picture_url: pictureURL,
        }),
      }),
    );
  const avatar = page.locator("main .ant-avatar").first();

  await show("élodie Martin");
  await page.goto(`${hubBaseURL}/u/shared-name`);
  await expect(avatar).toHaveText("É");

  // An emoji is one user-perceived character, not a lone surrogate half.
  await show("🚀 Rocket Co");
  await page.goto(`${hubBaseURL}/u/shared-name`);
  await expect(avatar).toHaveText("🚀");

  await show(
    "Remote Colleague",
    "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  );
  await page.goto(`${hubBaseURL}/u/shared-name`);
  await expect(avatar.locator("img")).toBeVisible();
  await expect(avatar).not.toHaveText("R");
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

async function showProfile(page: Page, overrides: Partial<PublicProfile>) {
  await page.route("**/api/hub/profile/read", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...profile, ...overrides }),
    }),
  );
}

test("websites are icon links in the header card, under the biography", async ({
  page,
}) => {
  await signedIn(page);
  await showProfile(page, {});
  const imageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image") imageRequests.push(request.url());
  });
  await page.goto(`${hubBaseURL}/u/shared-name`);

  const websites = page.getByRole("list", { name: "Websites" });
  await expect(websites.getByRole("listitem")).toHaveCount(4);
  // PROF-WEB-006: the known kinds show their name; any other host is shown
  // by its host name. The list follows the order the owner added them in.
  const links = websites.getByRole("link");
  await expect(links).toHaveText([
    "GitHub",
    "LinkedIn",
    "X",
    "remote-colleague.example.dev",
  ]);
  const hrefs = [
    "https://github.com/remote-colleague",
    "https://www.linkedin.com/in/remote-colleague",
    "https://x.com/remote_colleague",
    "https://remote-colleague.example.dev/blog",
  ];
  for (const [index, href] of hrefs.entries()) {
    const link = links.nth(index);
    // PROF-WEB-007: external, no referrer, no access to this page.
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }

  // PROF-WEB-008: after the biography, inside the header, before the history.
  const biography = await page
    .getByText("Building reliable systems.")
    .boundingBox();
  const list = await websites.boundingBox();
  const work = await page
    .getByText("Work experience", { exact: true })
    .boundingBox();
  expect(biography).not.toBeNull();
  expect(list).not.toBeNull();
  expect(work).not.toBeNull();
  expect(biography?.y ?? 0).toBeLessThan(list?.y ?? 0);
  expect(list?.y ?? 0).toBeLessThan(work?.y ?? 0);

  // PROF-WEB-007: nothing is loaded from the linked hosts, icons are local.
  await expect(page.locator('img[src*="github.com"]')).toHaveCount(0);
  await expect(page.locator('img[src*="favicon"]')).toHaveCount(0);
  expect(imageRequests.filter((url) => !url.startsWith("data:"))).toEqual([]);
});

test("a profile without websites shows no website list", async ({ page }) => {
  await signedIn(page);
  await showProfile(page, { websites: [] });
  await page.goto(`${hubBaseURL}/u/shared-name`);
  await expect(
    page.getByRole("heading", { name: "Remote Colleague" }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Websites" })).toHaveCount(0);
});

test("the kind comes from the exact host, so look-alike hosts stay generic websites", async ({
  page,
}) => {
  const site = (index: number, url: string) => ({
    id: `00000000-0000-4000-8000-00000000b${String(index).padStart(3, "0")}`,
    url,
  });
  await signedIn(page);
  await showProfile(page, {
    websites: [
      site(1, "https://www.github.com/octocat"),
      site(2, "https://gitlab.com/octocat"),
      site(3, "https://twitter.com/octocat"),
      site(4, "https://github.com.evil.example/octocat"),
      site(5, "https://notgithub.com/octocat"),
      site(6, "https://linkedin.com.example.org/in/octocat"),
    ],
  });
  await page.goto(`${hubBaseURL}/u/shared-name`);
  await expect(
    page.getByRole("list", { name: "Websites" }).getByRole("link"),
  ).toHaveText([
    "GitHub",
    "GitLab",
    "X",
    "github.com.evil.example",
    "notgithub.com",
    "linkedin.com.example.org",
  ]);
});

test("a website value that is not an HTTPS URL is shown as text and never linked", async ({
  page,
}) => {
  await signedIn(page);
  await showProfile(page, {
    websites: [
      {
        id: "00000000-0000-4000-8000-00000000c001",
        url: "javascript:alert(1)",
      },
      {
        id: "00000000-0000-4000-8000-00000000c002",
        url: "http://plain.example",
      },
      {
        id: "00000000-0000-4000-8000-00000000c003",
        url: "https://safe.example",
      },
    ],
  });
  await page.goto(`${hubBaseURL}/u/shared-name`);
  const websites = page.getByRole("list", { name: "Websites" });
  await expect(websites.getByRole("listitem")).toHaveCount(3);
  await expect(websites.getByRole("link")).toHaveText(["safe.example"]);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('a[href^="http:"]')).toHaveCount(0);
  await expect(websites.getByText("javascript:alert(1)")).toBeVisible();
});

test("very long website hosts wrap instead of widening the page", async ({
  page,
}) => {
  const longHost = `${"segment".repeat(8)}.${"another".repeat(6)}.example.com`;
  await signedIn(page);
  await showProfile(page, {
    websites: [
      {
        id: "00000000-0000-4000-8000-00000000d001",
        url: `https://${longHost}/path`,
      },
      {
        id: "00000000-0000-4000-8000-00000000d002",
        url: "https://github.com/x",
      },
    ],
  });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${hubBaseURL}/u/shared-name`);
    await expect(page.getByRole("link", { name: longHost })).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `page width ${width}`).toBeLessThanOrEqual(0);
  }
});
