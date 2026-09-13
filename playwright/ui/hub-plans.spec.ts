import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { HubSubscription } from "typespec/hub/subscriptions/subscriptions";

const hubBaseURL =
  process.env.PLAYWRIGHT_HUB_BASE_URL ?? "http://hub-ui.sgp.localhost";
const sessionKey = "vetchium.hub.session";
const sessionToken = "s".repeat(64);
const hubUserDID = "018f7e32-7b5a-7d31-8fd0-f7e2a852f144";
const handle = "perso-00000000001";

function myInfo(preferredLanguage = "en-US") {
  return {
    hub_user_did: hubUserDID,
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
    ({ key, sessionToken, hubUserDID, handle }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          session_token: sessionToken,
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
          preferred_language: "en-US",
          resident_country: "SG",
          hub_user_did: hubUserDID,
          handle,
          remembered: false,
        }),
      ),
    { key: sessionKey, sessionToken, hubUserDID, handle },
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
  await expect(page.getByText(monthly, { exact: false })).toBeVisible();
  await expect(page.getByText(annual, { exact: false })).toBeVisible();
  await expect(
    page.getByText(
      "The paid plans will support the development of the Vetchium FOSS project.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Current plan" }),
  ).toBeVisible();
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
    await expect(page.getByText(monthlyText, { exact: false })).toBeVisible();
    await expect(page.getByText(annualText, { exact: false })).toBeVisible();
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
  await expect.poll(() => received !== undefined).toBe(true);
  expect(received?.body).toEqual({
    plan_oid: "hub-silver-tier",
    billing_interval: "month",
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

  await page.getByRole("button", { name: "Cancel at period end" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(requestCount).toBe(0);

  await page.getByRole("button", { name: "Cancel at period end" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm" })
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

test("the home page invites a plan choice and shows a paid-plan nudge on free", async ({
  page,
}) => {
  await provideRuntimeConfig(page);
  await provideStoredSession(page);
  await provideMyInfo(page);
  await provideMySubscription(page, freeSubscription());
  await page.goto(hubBaseURL);
  await expect(page.getByRole("link", { name: "View plans" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Go to my profile" }),
  ).toBeVisible();
  await expect(
    page.getByText("Consider a paid plan to unlock more from Vetchium."),
  ).toBeVisible();

  await page.getByRole("link", { name: "Go to my profile" }).click();
  await expect(page).toHaveURL(`${hubBaseURL}/settings/profile`);

  await page.goto(hubBaseURL);
  await page.getByRole("link", { name: "View plans" }).click();
  await expect(page).toHaveURL(`${hubBaseURL}/plan`);
});

test("the home page hides the paid-plan nudge on a paid plan", async ({
  page,
}) => {
  await provideRuntimeConfig(page);
  await provideStoredSession(page);
  await provideMyInfo(page);
  await provideMySubscription(page, {
    plan_oid: "hub-silver-tier",
    billing_interval: "month",
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    cancel_at_period_end: false,
  });
  await page.goto(hubBaseURL);
  await expect(page.getByRole("link", { name: "View plans" })).toBeVisible();
  await expect(
    page.getByText("Consider a paid plan to unlock more from Vetchium."),
  ).toHaveCount(0);
});

test("the home page shows invitations without an error when the subscription fails to load", async ({
  page,
}) => {
  await provideRuntimeConfig(page);
  await provideStoredSession(page);
  await provideMyInfo(page);
  await provideMySubscription(page, "error");
  await page.goto(hubBaseURL);
  await expect(page.getByRole("link", { name: "View plans" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Go to my profile" }),
  ).toBeVisible();
  await expect(
    page.getByText("Consider a paid plan to unlock more from Vetchium."),
  ).toHaveCount(0);
  await expect(
    page.getByText("Something went wrong. Please try again."),
  ).toHaveCount(0);
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
