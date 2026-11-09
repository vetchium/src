import { expect, test } from "@playwright/test";
import { ORGS_PORTAL } from "../lib/portals.ts";

test("a visitor without a session enters through sign in", async ({ page }) => {
  await page.goto(ORGS_PORTAL);

  await expect(page).toHaveURL(`${ORGS_PORTAL}/login`);
  const headings = page.getByRole("heading", { level: 1 });
  await expect(headings).toHaveCount(1);
  await expect(headings).toHaveText("Sign in");
  await expect(page).toHaveTitle("Sign in | Vetchium for organizations");
  await expect(page.getByLabel("Organization domain")).toBeEnabled();
  await expect(page.getByRole("link", { name: "Sign it up" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Vetchium for organizations home" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
});

test("an unknown route offers a way back home", async ({ page }) => {
  await page.goto(`${ORGS_PORTAL}/no-such-page`);

  await expect(page.getByText("Page not found")).toBeVisible();
  await page.getByRole("link", { name: "Go to home" }).click();

  // Home needs a session, so a visitor lands on sign in.
  await expect(page).toHaveURL(`${ORGS_PORTAL}/login`);
});

test("language and theme choices survive a reload", async ({ page }) => {
  await page.goto(ORGS_PORTAL);
  await page.getByRole("switch", { name: "Switch light or dark mode" }).click();
  await page.getByRole("combobox", { name: "Select language" }).click();
  await page.getByRole("option", { name: "Deutsch (Deutschland)" }).click();

  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");

  await page.reload();

  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await expect(
    page.getByRole("switch", {
      name: "Zwischen hellem und dunklem Modus wechseln",
    }),
  ).toBeChecked();
});

test("a suggested primary color recolors the portal and survives a reload", async ({
  page,
}) => {
  await page.goto(ORGS_PORTAL);
  const picker = page.getByRole("button", { name: "Primary color" });
  const icon = picker.getByRole("img");
  await expect(icon).toHaveCSS("color", "rgb(37, 99, 235)");

  await picker.click();
  const suggested = page.getByRole("group", { name: "Suggested colors" });
  await suggested.getByRole("button", { name: "#722ed1" }).click();
  await expect(icon).toHaveCSS("color", "rgb(114, 46, 209)");
  await expect(
    suggested.getByRole("button", { name: "#722ed1" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(icon).toHaveCSS("color", "rgb(114, 46, 209)");

  await picker.click();
  await page
    .getByRole("group", { name: "Suggested colors" })
    .getByRole("button", { name: "#2563eb" })
    .click();
  await expect(icon).toHaveCSS("color", "rgb(37, 99, 235)");
  expect(
    await page.evaluate(() => localStorage.getItem("vetchium.primaryColor")),
  ).toBeNull();
});

test("a custom primary color applies unless white text on it is unreadable", async ({
  page,
}) => {
  await page.goto(ORGS_PORTAL);
  const picker = page.getByRole("button", { name: "Primary color" });
  const icon = picker.getByRole("img");
  await picker.click();
  const hex = page.getByRole("tooltip").getByRole("textbox");

  await hex.fill("0b6e4f");
  await expect(icon).toHaveCSS("color", "rgb(11, 110, 79)");

  await hex.fill("ffe58f");
  await expect(
    page.getByText("Too light for white text on buttons."),
  ).toBeVisible();
  await expect(icon).toHaveCSS("color", "rgb(11, 110, 79)");

  await page.reload();
  await expect(icon).toHaveCSS("color", "rgb(11, 110, 79)");
});

test("a stored primary color that is not usable falls back to the portal's own", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("vetchium.primaryColor", "#ffe58f"),
  );
  await page.goto(ORGS_PORTAL);

  await expect(
    page.getByRole("button", { name: "Primary color" }).getByRole("img"),
  ).toHaveCSS("color", "rgb(37, 99, 235)");
});

test("the header fits a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(ORGS_PORTAL);

  await expect(
    page.getByRole("combobox", { name: "Select language" }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Switch light or dark mode" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Primary color" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

for (const [reducedMotion, animates] of [
  ["no-preference", true],
  ["reduce", false],
] as const) {
  test.describe(`prefers-reduced-motion: ${reducedMotion}`, () => {
    test.use({ contextOptions: { reducedMotion } });

    test(`menus ${animates ? "animate" : "open without animation"}`, async ({
      page,
    }) => {
      await page.goto(ORGS_PORTAL);
      // Frozen animations stay observable however slowly the test runs.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Animation.enable");
      await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
      await page.getByRole("combobox", { name: "Select language" }).click();
      const option = page.getByRole("option", {
        name: "Deutsch (Deutschland)",
      });
      await expect(option).toBeAttached();
      const animations = () =>
        option.evaluate(
          (element) =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect instanceof KeyframeEffect &&
                  animation.effect.target?.contains(element) === true,
              ).length,
        );
      if (animates) {
        await expect.poll(animations).toBeGreaterThan(0);
      } else {
        await expect(option).toBeVisible();
        expect(await animations()).toBe(0);
      }
    });
  });
}
