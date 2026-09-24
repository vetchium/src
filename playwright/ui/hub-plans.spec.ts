import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { PublicProfile } from "typespec/hub/profile/public";
import type { HubSubscription } from "typespec/hub/subscriptions/subscriptions";

const hubBaseURL =
  process.env.PLAYWRIGHT_HUB_BASE_URL ?? "http://hub-ui.sgp.localhost";
const sessionKey = "vetchium.hub.session";
const sessionToken = "s".repeat(64);
const handle = "perso-00000000001";

function myInfo(preferredLanguage = "en-US") {
  return {
    handle,
    email_address: "person@example.com",
    display_name: "Example Person",
    preferred_language: preferredLanguage,
    resident_country: "SG",
    preferred_job_countries: ["SG"],
    totp_enabled: false,
    recovery_codes_remaining: 0,
    session_authenticated_at: new Date().toISOString(),
  };
}

async function provideStoredSession(page: Page) {
  await page.addInitScript(
    ({ key, sessionToken, handle }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          session_token: sessionToken,
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
          preferred_language: "en-US",
          resident_country: "SG",
          handle,
          remembered: false,
        }),
      ),
    { key: sessionKey, sessionToken, handle },
  );
}

async function provideMyInfo(page: Page, preferredLanguage = "en-US") {
  await page.route("**/api/hub/my-info", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(myInfo(preferredLanguage)),
    });
  });
}

function freeSubscription(): HubSubscription {
  return { plan_oid: "hub-free-tier", cancel_at_period_end: false };
}

async function provideMySubscription(
  page: Page,
  subscription: HubSubscription | "error" | "unauthorized" = freeSubscription(),
) {
  await page.route("**/api/hub/my-subscription", async (route) => {
    if (subscription === "error") {
      await route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "vetchium-problem-details/internal-server-error",
          title: "Internal Server Error",
          status: 500,
        }),
      });
      return;
    }
    if (subscription === "unauthorized") {
      await route.fulfill({
        status: 401,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "vetchium-problem-details/hub-authentication-required",
          title: "Hub authentication required",
          status: 401,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(subscription),
    });
  });
}

async function provideRuntimeConfig(
  page: Page,
  options: { tenantId?: string; hubPlans?: string[]; language?: string } = {},
) {
  const tenantId = options.tenantId ?? "sgp";
  const hubPlans = options.hubPlans ?? ["hub-free-tier", "hub-silver-tier"];
  const language = options.language ?? "en-US";
  await page.route("**/runtime-config.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `globalThis.__VETCHIUM_CONFIG__ = Object.freeze({ defaultLanguage: ${JSON.stringify(
        language,
      )}, tenantId: ${JSON.stringify(tenantId)}, hubPlans: Object.freeze(${JSON.stringify(
        hubPlans,
      )}) });`,
    });
  });
}

async function gotoPlanPage(
  page: Page,
  options: { tenantId?: string; hubPlans?: string[]; language?: string } = {},
) {
  await provideRuntimeConfig(page, options);
  await provideStoredSession(page);
  await provideMyInfo(page, options.language ?? "en-US");
  await page.goto(`${hubBaseURL}/plan`);
}

test("the plan page requires a session", async ({ page }) => {
  await provideRuntimeConfig(page);
  await page.goto(`${hubBaseURL}/plan`);
  await expect(page).toHaveURL(/\/login/);
});

test("a held subscription request shows a loading skeleton with no actions", async ({
  page,
}) => {
  await provideRuntimeConfig(page);
  await provideStoredSession(page);
  await provideMyInfo(page);
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/hub/my-subscription", async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(freeSubscription()),
    });
  });
  await page.goto(`${hubBaseURL}/plan`);
  await expect(
    page.getByRole("status", { name: "Loading your subscription" }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  release?.();
  await expect(
    page.getByRole("button", { name: "Current plan" }),
  ).toBeVisible();
});

test("a load failure shows the generic error with a working retry", async ({
  page,
}) => {
  await provideRuntimeConfig(page);
  await provideStoredSession(page);
  await provideMyInfo(page);
  let fail = true;
  await page.route("**/api/hub/my-subscription", async (route) => {
    if (fail) {
      await route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "vetchium-problem-details/internal-server-error",
          title: "Internal Server Error",
          status: 500,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(freeSubscription()),
    });
  });
  await page.goto(`${hubBaseURL}/plan`);
  await expect(
    page.getByText("Something went wrong. Please try again."),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("button", { name: "Current plan" }),
  ).toBeVisible();
});

test("a session-expiry failure clears the session and shows sign-in", async ({
  page,
}) => {
  await provideRuntimeConfig(page);
  await provideStoredSession(page);
  await provideMyInfo(page);
  await provideMySubscription(page, "unauthorized");
  await page.goto(`${hubBaseURL}/plan`);
  await expect(page).toHaveURL(/\/login/);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), sessionKey),
  ).toBeNull();
});

test("the plan page on sgp shows both plans with translated names and prices", async ({
  page,
}) => {
  await provideMySubscription(page);
  await gotoPlanPage(page);
  await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
  await expect(page.getByText("Free", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Silver", { exact: true }).last()).toBeVisible();
  const monthly = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "SGD",
  }).format(10);
  const annual = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "SGD",
  }).format(110);
  const silverPlan = page.getByRole("region", { name: "Silver plan" });
  await expect(silverPlan.getByText(monthly, { exact: false })).toBeVisible();
  await expect(silverPlan.getByText(annual, { exact: false })).toHaveCount(0);
  await expect(
    silverPlan.getByText("Long posts", { exact: true }),
  ).toBeVisible();
  await expect(
    silverPlan.getByText("Profile picture support", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The paid plans will support the development of the Vetchium FOSS project.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Current plan" }),
  ).toBeVisible();

  await page.getByText("Annual", { exact: true }).click();
  await expect(silverPlan.getByText(annual, { exact: false })).toBeVisible();
  await expect(silverPlan.getByText(monthly, { exact: false })).toHaveCount(0);
});

test("the plan comparison fits a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await provideMySubscription(page);
  await gotoPlanPage(page);
  await expect(page.getByRole("region", { name: "Free plan" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Silver plan" })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
});

for (const [tenant, currency, monthly, annual] of [
  ["usa1", "USD", 10, 110],
  ["deu", "EUR", 10, 110],
  ["sgp", "SGD", 10, 110],
  ["ind1", "INR", 1000, 11000],
] as const) {
  test(`prices for ${tenant} use its currency and eleven-month annual pricing`, async ({
    page,
  }) => {
    await provideMySubscription(page);
    await gotoPlanPage(page, { tenantId: tenant });
    const monthlyText = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(monthly);
    const annualText = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(annual);
    const silverPlan = page.getByRole("region", { name: "Silver plan" });
    await expect(
      silverPlan.getByText(monthlyText, { exact: false }),
    ).toBeVisible();
    await page.getByText("Annual", { exact: true }).click();
    await expect(
      silverPlan.getByText(annualText, { exact: false }),
    ).toBeVisible();
    expect(annual).toBe(monthly * 11);
  });
}

test("an unrecognized tenant hides the silver plan", async ({ page }) => {
  await provideMySubscription(page);
  await gotoPlanPage(page, { tenantId: "zz9" });
  await expect(page.getByText("Free", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Silver", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      "The paid plans will support the development of the Vetchium FOSS project.",
    ),
  ).toHaveCount(0);
});

test("a runtime configuration offering only the free plan hides silver", async ({
  page,
}) => {
  await provideMySubscription(page);
  await gotoPlanPage(page, { hubPlans: ["hub-free-tier"] });
  await expect(page.getByText("Free", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Silver", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      "The paid plans will support the development of the Vetchium FOSS project.",
    ),
  ).toHaveCount(0);
});

test("an upgrade sends an idempotency key and the expected body", async ({
  page,
}) => {
  await provideMySubscription(page);
  await gotoPlanPage(page);
  let received: { headers: Record<string, string>; body: unknown } | undefined;
  await page.route("**/api/hub/set-subscription-plan", async (route) => {
    received = {
      headers: route.request().headers(),
      body: route.request().postDataJSON(),
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan_oid: "hub-silver-tier",
        billing_interval: "year",
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(
          Date.now() + 365 * 86_400_000,
        ).toISOString(),
        cancel_at_period_end: false,
      }),
    });
  });
  await page.getByText("Annual", { exact: true }).click();
  await page.getByRole("button", { name: "Upgrade" }).click();
  await expect.poll(() => received !== undefined).toBe(true);
  expect(received?.body).toEqual({
    plan_oid: "hub-silver-tier",
    billing_interval: "year",
  });
  expect(received?.headers["idempotency-key"]).toBeTruthy();
  await expect(page.getByRole("row", { name: "Plan : Silver" })).toBeVisible();
});

test("a downgrade confirms before sending and shows the scheduled change", async ({
  page,
}) => {
  const periodEnd = new Date(Date.now() + 365 * 86_400_000);
  await provideMySubscription(page, {
    plan_oid: "hub-silver-tier",
    billing_interval: "year",
    current_period_start: new Date().toISOString(),
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
  });
  await gotoPlanPage(page);
  let requestCount = 0;
  await page.route("**/api/hub/set-subscription-plan", async (route) => {
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan_oid: "hub-silver-tier",
        billing_interval: "year",
        current_period_start: new Date().toISOString(),
        current_period_end: periodEnd.toISOString(),
        cancel_at_period_end: true,
        scheduled_change: { plan_oid: "hub-free-tier" },
      }),
    });
  });

  const switchToFree = page
    .getByRole("region", { name: "Free plan" })
    .getByRole("button", { name: "Switch to Free" });
  await switchToFree.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Go back" }).click();
  expect(requestCount).toBe(0);

  await switchToFree.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Switch to Free" })
    .click();
  await expect.poll(() => requestCount).toBe(1);
  const expectedDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
  }).format(periodEnd);
  await expect(
    page.getByText(`Cancels at the end of the period, on ${expectedDate}.`),
  ).toBeVisible();
});

test("keep this plan sends the current plan and interval", async ({ page }) => {
  await provideMySubscription(page, {
    plan_oid: "hub-silver-tier",
    billing_interval: "year",
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    cancel_at_period_end: false,
    scheduled_change: {
      plan_oid: "hub-silver-tier",
      billing_interval: "month",
    },
  });
  await gotoPlanPage(page);
  let received: unknown;
  await page.route("**/api/hub/set-subscription-plan", async (route) => {
    received = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan_oid: "hub-silver-tier",
        billing_interval: "year",
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(
          Date.now() + 365 * 86_400_000,
        ).toISOString(),
        cancel_at_period_end: false,
      }),
    });
  });
  await page.getByRole("button", { name: "Keep this plan" }).click();
  await expect.poll(() => received !== undefined).toBe(true);
  expect(received).toEqual({
    plan_oid: "hub-silver-tier",
    billing_interval: "year",
  });
});

test("the current subscription card shows the billing interval and a scheduled annual to monthly change", async ({
  page,
}) => {
  const periodEnd = new Date(Date.now() + 365 * 86_400_000);
  await provideMySubscription(page, {
    plan_oid: "hub-silver-tier",
    billing_interval: "year",
    current_period_start: new Date().toISOString(),
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
    scheduled_change: {
      plan_oid: "hub-silver-tier",
      billing_interval: "month",
    },
  });
  await gotoPlanPage(page);
  await expect(
    page.getByRole("row", { name: "Billing interval : Annual" }),
  ).toBeVisible();
  const expectedDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
  }).format(periodEnd);
  await expect(
    page.getByText(`Switches to Silver (Monthly) on ${expectedDate}.`),
  ).toBeVisible();
});

test("mutation errors show translated or generic messages and re-enable actions", async ({
  page,
}) => {
  await provideMySubscription(page);
  await gotoPlanPage(page);
  await page.route("**/api/hub/set-subscription-plan", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "vetchium-problem-details/hub-plan-not-offered",
        title: "Hub plan not offered",
        status: 403,
      }),
    });
  });
  await page.getByRole("button", { name: "Upgrade" }).first().click();
  await expect(
    page.getByText("This plan is not available for your account."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upgrade" }).first(),
  ).toBeEnabled();

  await page.route("**/api/hub/set-subscription-plan", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "vetchium-problem-details/internal-server-error",
        title: "Internal Server Error",
        status: 500,
      }),
    });
  });
  await page.getByRole("button", { name: "Upgrade" }).first().click();
  await expect(
    page.getByText("Something went wrong. Please try again."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upgrade" }).first(),
  ).toBeEnabled();
});

test("a retry after a network failure reuses the same idempotency key", async ({
  page,
}) => {
  await provideMySubscription(page);
  await gotoPlanPage(page);
  const keys: string[] = [];
  let failFirst = true;
  await page.route("**/api/hub/set-subscription-plan", async (route) => {
    const key = route.request().headers()["idempotency-key"];
    if (key !== undefined) keys.push(key);
    if (failFirst) {
      failFirst = false;
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan_oid: "hub-silver-tier",
        billing_interval: "month",
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(
          Date.now() + 30 * 86_400_000,
        ).toISOString(),
        cancel_at_period_end: false,
      }),
    });
  });
  await page.getByRole("button", { name: "Upgrade" }).first().click();
  await expect(
    page.getByText("Something went wrong. Please try again."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upgrade" }).first().click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
});

test("an unknown current plan disables every action and shows the raw OID", async ({
  page,
}) => {
  await provideMySubscription(page, {
    plan_oid: "hub-gold-tier",
    cancel_at_period_end: false,
  });
  await gotoPlanPage(page);
  await expect(
    page.getByText("This plan cannot be changed here"),
  ).toBeVisible();
  await expect(page.getByText("hub-gold-tier").first()).toBeVisible();
  const buttons = await page.getByRole("main").getByRole("button").all();
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    await expect(button).toBeDisabled();
  }
});

test("an unknown scheduled plan also disables every action", async ({
  page,
}) => {
  await provideMySubscription(page, {
    plan_oid: "hub-silver-tier",
    billing_interval: "month",
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    cancel_at_period_end: false,
    scheduled_change: { plan_oid: "hub-gold-tier" },
  });
  await gotoPlanPage(page);
  await expect(
    page.getByText("This plan cannot be changed here"),
  ).toBeVisible();
  await expect(page.getByText("hub-gold-tier").first()).toBeVisible();
  const buttons = await page.getByRole("main").getByRole("button").all();
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    await expect(button).toBeDisabled();
  }
});

test("the plan page is translated for de-DE", async ({ page }) => {
  await provideMySubscription(page);
  await gotoPlanPage(page, { language: "de-DE" });
  await page.addInitScript(() =>
    localStorage.setItem("vetchium.language", "de-DE"),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Tarife" })).toBeVisible();
  await expect(
    page.getByText("Kostenlos", { exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByText("Silber", { exact: true }).last()).toBeVisible();
  const monthly = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "SGD",
  }).format(10);
  await expect(page.getByText(monthly, { exact: false }).first()).toBeVisible();
});

test("the plan page is translated for ta", async ({ page }) => {
  await provideMySubscription(page);
  await gotoPlanPage(page, { language: "ta" });
  await page.addInitScript(() =>
    localStorage.setItem("vetchium.language", "ta"),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "திட்டங்கள்" })).toBeVisible();
  await expect(page.getByText("இலவசம்", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("வெள்ளி", { exact: true }).last()).toBeVisible();
  const monthly = new Intl.NumberFormat("ta", {
    style: "currency",
    currency: "SGD",
  }).format(10);
  await expect(page.getByText(monthly, { exact: false }).first()).toBeVisible();
});

function silverSubscription(): HubSubscription {
  return {
    plan_oid: "hub-silver-tier",
    billing_interval: "month",
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    cancel_at_period_end: false,
  };
}

const emptyProfile: PublicProfile = {
  display_name: "Example Person",
  handle,
  resident_country: "SG",
  work_experiences: [],
  educational_qualifications: [],
  certifications: [],
  language_abilities: [],
};

async function gotoHomePage(
  page: Page,
  options: {
    subscription?: HubSubscription | "error";
    profile?: PublicProfile;
    totpEnabled?: boolean;
  } = {},
) {
  await provideRuntimeConfig(page);
  await provideStoredSession(page);
  await page.route("**/api/hub/my-info", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...myInfo(),
        totp_enabled: options.totpEnabled ?? false,
      }),
    });
  });
  await page.route("**/api/hub/profile/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.profile ?? emptyProfile),
    });
  });
  await provideMySubscription(page, options.subscription ?? freeSubscription());
  await page.goto(hubBaseURL);
  await expect(
    page.getByRole("heading", { name: "Welcome back, Example Person" }),
  ).toBeVisible();
}

test("the home page invites a free-tier user to support Vetchium", async ({
  page,
}) => {
  await gotoHomePage(page);
  await expect(
    page.getByText("Vetchium is free and open-source software.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "See plans" }).click();
  await expect(page).toHaveURL(`${hubBaseURL}/plan`);
});

test("the home page shows no plan invitation on a paid plan", async ({
  page,
}) => {
  await gotoHomePage(page, { subscription: silverSubscription() });
  await expect(
    page.getByRole("link", { name: "Edit my profile" }),
  ).toBeVisible();
  await expect(page.getByText("Support Vetchium")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "See plans" })).toHaveCount(0);
});

test("the home page shows no plan invitation or error when the subscription fails to load", async ({
  page,
}) => {
  await gotoHomePage(page, { subscription: "error" });
  await expect(
    page.getByRole("link", { name: "Edit my profile" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "See plans" })).toHaveCount(0);
  await expect(
    page.getByText("Something went wrong. Please try again."),
  ).toHaveCount(0);
});

test("the home page lists the profile sections still to fill in", async ({
  page,
}) => {
  await gotoHomePage(page);
  await expect(page.getByText("0 of 4 sections complete")).toBeVisible();
  for (const item of [
    "Write a short biography",
    "Add your work experience",
    "Add your education",
    "Add the languages you use",
  ]) {
    await expect(page.getByText(item, { exact: true })).toBeVisible();
  }
  await page.getByRole("link", { name: "Edit my profile" }).click();
  await expect(page).toHaveURL(`${hubBaseURL}/settings/profile`);
});

test("the home page confirms a complete profile without a checklist", async ({
  page,
}) => {
  await gotoHomePage(page, {
    profile: {
      ...emptyProfile,
      biography: "Builds reliable systems.",
      work_experiences: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          employer_domain: "example.com",
          job_title: "Engineer",
          start_month: "2021-01",
        },
      ],
      educational_qualifications: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          institution_domain: "example.edu",
          degree: "BSc",
        },
      ],
      language_abilities: [{ language_tag: "en", ability: "speaking" }],
    },
  });
  await expect(page.getByText("4 of 4 sections complete")).toBeVisible();
  await expect(
    page.getByText("Your profile is complete.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Write a short biography")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "View my profile" }),
  ).toHaveAttribute("href", `/u/${handle}`);
});

test("the home page suggests two-factor authentication only while it is off", async ({
  page,
}) => {
  await gotoHomePage(page);
  await page
    .getByRole("link", { name: "Set up two-factor authentication" })
    .click();
  await expect(page).toHaveURL(`${hubBaseURL}/settings/security`);
});

test("the home page omits the two-factor suggestion once it is on", async ({
  page,
}) => {
  await gotoHomePage(page, {
    subscription: silverSubscription(),
    totpEnabled: true,
  });
  await expect(
    page.getByRole("link", { name: "Edit my profile" }),
  ).toBeVisible();
  await expect(page.getByText("Protect your account")).toHaveCount(0);
});

test("a free-tier plan page recommends Silver", async ({ page }) => {
  await provideMySubscription(page);
  await gotoPlanPage(page);
  await expect(
    page.getByText("Choose the plan that fits how you share and connect.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("Recommended", { exact: true })).toBeVisible();
  await expect(page.getByText("Your plan", { exact: true })).toHaveCount(0);
});

test("a paid subscriber sees their plan first and Free as a quiet option", async ({
  page,
}) => {
  await provideMySubscription(page, silverSubscription());
  await gotoPlanPage(page);
  await expect(
    page.getByText(
      "Thank you for supporting the development of the Vetchium FOSS project.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Your plan", { exact: true })).toBeVisible();
  await expect(page.getByText("Recommended", { exact: true })).toHaveCount(0);
  const silverPlan = page.getByRole("region", { name: "Silver plan" });
  const freePlan = page.getByRole("region", { name: "Free plan" });
  await expect(
    silverPlan.getByRole("button", { name: "Current plan" }),
  ).toBeDisabled();
  await expect(
    freePlan.getByRole("button", { name: "Switch to Free" }),
  ).toBeEnabled();
  const silverBorder = await silverPlan.evaluate(
    (element) => getComputedStyle(element).borderTopWidth,
  );
  expect(silverBorder).toBe("2px");
  const periodRow = page.getByRole("row", { name: /Current period/ });
  const periodBox = await periodRow.boundingBox();
  const silverBox = await silverPlan.boundingBox();
  expect(periodBox?.y ?? Infinity).toBeLessThan(silverBox?.y ?? 0);
});

for (const [locale, title, payments] of [
  ["en-US", "Terms and Conditions", "Payments"],
  ["de-DE", "Allgemeine Geschäftsbedingungen", "Zahlungen"],
  ["ta", "விதிமுறைகள் மற்றும் நிபந்தனைகள்", "கட்டணங்கள்"],
] as const) {
  test(`the terms page is translated for ${locale} and reachable signed out`, async ({
    page,
  }) => {
    await page.addInitScript(
      (lang) => localStorage.setItem("vetchium.language", lang),
      locale,
    );
    await page.goto(`${hubBaseURL}/terms`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("heading", { name: payments })).toBeVisible();
  });
}

test("terms is reachable signed in and linked from signup", async ({
  page,
}) => {
  await provideRuntimeConfig(page);
  await provideStoredSession(page);
  await provideMyInfo(page);
  await provideMySubscription(page);
  await page.goto(`${hubBaseURL}/terms`);
  await expect(
    page.getByRole("heading", { name: "Terms and Conditions" }),
  ).toBeVisible();

  await page.goto(`${hubBaseURL}/signup`);
  await expect(
    page.getByRole("link", { name: "Terms and Conditions" }),
  ).toBeVisible();
});
