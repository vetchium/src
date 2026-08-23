import { expect, test } from "@playwright/test";

const hubBaseURL =
  process.env.PLAYWRIGHT_HUB_BASE_URL ?? "http://hub-ui.sgp.localhost";
const sessionTokenKey = "vetchium.hub.session-token";

async function provideStoredSession(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ key }) => sessionStorage.setItem(key, "test-session"),
    { key: sessionTokenKey },
  );
}

test("a visitor without a session enters through sign in", async ({ page }) => {
  await page.goto(hubBaseURL);

  await expect(page).toHaveURL(`${hubBaseURL}/login`);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Email address" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
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
  await expect(page.getByRole("menuitem")).toHaveCount(1);
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
    await page.evaluate((key) => sessionStorage.getItem(key), sessionTokenKey),
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
  await expect(navigation.getByRole("menuitem")).toHaveCount(1);
  await expect(
    navigation.getByRole("menuitem", { name: "Home" }),
  ).toBeVisible();
});
