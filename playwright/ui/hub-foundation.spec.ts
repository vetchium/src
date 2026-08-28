import { expect, test } from "@playwright/test";

const hubBaseURL =
  process.env.PLAYWRIGHT_HUB_BASE_URL ?? "http://hub-ui.sgp.localhost";
const sessionKey = "vetchium.hub.session";
const sessionToken = "s".repeat(64);
const hubUserDID = "018f7e32-7b5a-7d31-8fd0-f7e2a852f144";
const handle = "perso-00000000001";

function myInfo(sessionAuthenticatedAt = new Date().toISOString()) {
  return {
    hub_user_did: hubUserDID,
    handle,
    email_address: "person@example.com",
    display_name: "Example Person",
    preferred_language: "en-US",
    resident_country: "SGP",
    totp_enabled: false,
    recovery_codes_remaining: 0,
    session_authenticated_at: sessionAuthenticatedAt,
  };
}

async function provideMyInfo(
  page: import("@playwright/test").Page,
  sessionAuthenticatedAt?: string,
) {
  await page.route("**/api/hub/my-info", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(myInfo(sessionAuthenticatedAt)),
    });
  });
}

async function provideStoredSession(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ key, sessionToken, hubUserDID, handle }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          session_token: sessionToken,
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
          preferred_language: "en-US",
          resident_country: "SGP",
          hub_user_did: hubUserDID,
          handle,
          remembered: false,
        }),
      ),
    { key: sessionKey, sessionToken, hubUserDID, handle },
  );
}

test("a visitor without a session enters through sign in", async ({ page }) => {
  await page.goto(hubBaseURL);

  await expect(page).toHaveURL(`${hubBaseURL}/login`);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Email address" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Password", { exact: true })).toBeEnabled();
  await expect(
    page.getByRole("link", { name: "Create an account" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Hub");
});

test("a visitor with a stored session sees the placeholder home", async ({
  page,
}) => {
  await provideStoredSession(page);
  await provideMyInfo(page);
  await page.goto(`${hubBaseURL}/login`);

  await expect(page).toHaveURL(`${hubBaseURL}/`);
  await expect(
    page.getByRole("heading", { name: "Vetchium home page" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveCount(3);
  await expect(page.getByRole("menuitem", { name: "Home" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Hub");
});

test("sign out clears the stored session and returns to sign in", async ({
  page,
}) => {
  await provideStoredSession(page);
  await provideMyInfo(page);
  await page.route("**/api/hub/logout", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.goto(hubBaseURL);
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(`${hubBaseURL}/login`);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), sessionKey),
  ).toBeNull();
});

test("the single home entry remains usable on a narrow viewport", async ({
  page,
}) => {
  await provideStoredSession(page);
  await provideMyInfo(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(hubBaseURL);

  const header = page.getByRole("banner");
  await expect(
    header.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await expect(
    header.getByRole("button", { name: "Vetchium home" }),
  ).toBeVisible();
  expect(
    await header.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  await header.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page.getByRole("dialog", { name: "Navigation" });
  await expect(navigation.getByRole("menuitem")).toHaveCount(3);
  await expect(
    navigation.getByRole("menuitem", { name: "Home" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("menuitem", { name: "My profile" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("menuitem", { name: "Security" }),
  ).toBeVisible();
});

test("signup offers only supported languages and ISO resident countries", async ({
  page,
}) => {
  await page.goto(`${hubBaseURL}/signup`);
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  const language = page.getByRole("combobox", {
    name: "* Language",
    exact: true,
  });
  await expect(
    page.getByRole("main").getByText("English US", { exact: true }),
  ).toBeVisible();
  await language.click();
  await expect(page.getByText("தமிழ்", { exact: true })).toBeVisible();
  await expect(page.getByText("Deutsch", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const residentCountry = page.getByLabel("Resident country");
  await residentCountry.fill("SGP");
  await expect(
    page.locator(".ant-select-item-option-content", { hasText: /^SGP$/ }),
  ).toBeVisible();
  await residentCountry.fill("USA");
  await expect(
    page.locator(".ant-select-item-option-content", { hasText: /^USA$/ }),
  ).toBeVisible();
});

test("password sign in stores the returned session and opens the home page", async ({
  page,
}) => {
  await provideMyInfo(page);
  await page.route("**/api/hub/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authentication_state: "authenticated",
        session_token: sessionToken,
        session_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        preferred_language: "en-US",
        resident_country: "SGP",
        hub_user_did: hubUserDID,
        handle,
      }),
    });
  });
  await page.goto(`${hubBaseURL}/login`);
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("person@example.com");
  await page.getByLabel("Password", { exact: true }).fill("a valid password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${hubBaseURL}/`);
  await expect(
    page.getByRole("heading", { name: "Vetchium home page" }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), sessionKey),
  ).toContain(sessionToken);
});

test("an API authentication failure clears the matching session", async ({
  page,
}) => {
  await provideStoredSession(page);
  await page.route("**/api/hub/my-info", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "vetchium-problem-details/hub-authentication-required",
        title: "Hub authentication required",
        status: 401,
      }),
    });
  });
  await page.goto(`${hubBaseURL}/settings/profile`);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), sessionKey),
  ).toBeNull();
});

test("an old session asks for password confirmation before security settings", async ({
  page,
}) => {
  await provideStoredSession(page);
  await provideMyInfo(page, new Date(Date.now() - 10 * 60_000).toISOString());
  await page.goto(`${hubBaseURL}/settings/security`);
  await expect(page).toHaveURL(/\/reauthenticate\?returnTo=/);
  await expect(
    page.getByRole("heading", { name: "Confirm your password" }),
  ).toBeVisible();
});

test("recovery-code sign in uses text input and can restart", async ({
  page,
}) => {
  await page.route("**/api/hub/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authentication_state: "totp_required",
        login_challenge_token: "c".repeat(64),
        login_challenge_expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
  });
  await page.goto(`${hubBaseURL}/login`);
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("person@example.com");
  await page.getByLabel("Password", { exact: true }).fill("a valid password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\/two-factor/);
  await page.getByText("Recovery code", { exact: true }).click();
  const code = page.getByRole("textbox", { name: "Recovery code" });
  await expect(code).toHaveAttribute("inputmode", "text");
  await page.getByRole("button", { name: "Start sign in again" }).click();
  await expect(page).toHaveURL(`${hubBaseURL}/login`);
});

test("unknown routes show a useful not-found page", async ({ page }) => {
  await page.goto(`${hubBaseURL}/does-not-exist`);
  await expect(page.getByText("Page not found", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to home" })).toBeVisible();
});

test("signup defaults to the current interface language", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("vetchium.language", "ta"),
  );
  await page.goto(`${hubBaseURL}/signup`);
  await expect(
    page.getByRole("main").getByText("தமிழ்", { exact: true }),
  ).toBeVisible();
});
