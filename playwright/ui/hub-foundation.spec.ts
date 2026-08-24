import { expect, test } from "@playwright/test";

const hubBaseURL =
  process.env.PLAYWRIGHT_HUB_BASE_URL ?? "http://hub-ui.sgp.localhost";
const sessionKey = "vetchium.hub.session";

async function provideStoredSession(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ key }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          session_token: "test-session",
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
          preferred_language: "en-US",
          resident_country: "SGP",
          hub_user_did: "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
          handle: "perso-00000000001",
          remembered: false,
        }),
      ),
    { key: sessionKey },
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
  await page.goto(`${hubBaseURL}/login`);

  await expect(page).toHaveURL(`${hubBaseURL}/`);
  await expect(
    page.getByRole("heading", { name: "Vetchium home page" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveCount(2);
  await expect(page.getByRole("menuitem", { name: "Home" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Hub");
});

test("sign out clears the stored session and returns to sign in", async ({
  page,
}) => {
  await provideStoredSession(page);
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
  await expect(navigation.getByRole("menuitem")).toHaveCount(2);
  await expect(
    navigation.getByRole("menuitem", { name: "Home" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("menuitem", { name: "Settings" }),
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
  await page.route("**/api/hub/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authentication_state: "authenticated",
        session_token: "mock-session-token",
        session_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        preferred_language: "en-US",
        resident_country: "SGP",
        hub_user_did: "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
        handle: "perso-00000000001",
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
  ).toContain("mock-session-token");
});
