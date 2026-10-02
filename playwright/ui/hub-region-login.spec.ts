import { HUB_PORTAL, ORGS_PORTAL, rememberRegion } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  expectSelectedRegion,
  recordRegionalAPIHosts,
  regionPicker,
  test,
} from "../lib/region-ui.ts";

for (const [portal, origin] of [
  ["hub", HUB_PORTAL],
  ["orgs", ORGS_PORTAL],
] as const) {
  test(`${portal} sign-in requires a fresh region choice despite saved preferences and links`, async ({
    context,
    page,
  }) => {
    await rememberRegion(context, portal, "sgp");
    const hosts = recordRegionalAPIHosts(page);
    for (const query of [
      "",
      "?region=deu",
      "?region=nowhere",
      "?region=deu&region=deu",
    ]) {
      await page.goto(`${origin}/login${query}`);
      await expect(regionPicker(page)).toBeVisible();
      await expect(regionPicker(page).locator("..")).not.toHaveAttribute(
        "title",
        /\((sgp|deu|usa1|ind1)\)$/,
      );
      const submit = page.getByRole("button", { name: "Sign in" });
      await expect(submit).toBeDisabled();
      if (portal === "orgs")
        await page.getByLabel("Organization domain").fill("unknown.example");
      await page.getByLabel("Email address").fill("unknown@example.com");
      const password = page.getByLabel("Password", { exact: true });
      await password.fill("Wrong-password");
      await expect(submit).toBeDisabled();
      await password.press("Enter");
      await chooseRegion(page, "deu");
      await expectSelectedRegion(page, "deu");
      await expect(submit).toBeEnabled();
    }
    expect(hosts).toEqual([]);
  });

  test(`${portal} sign-in never preselects a region from browser locale`, async ({
    browser,
  }) => {
    for (const locale of ["de-DE", "en-IN", "en-US", "ja-JP", "en"]) {
      const context = await browser.newContext({ locale });
      try {
        const page = await context.newPage();
        await page.goto(`${origin}/login`);
        await expect(
          page.getByRole("combobox").first().locator(".."),
        ).not.toHaveAttribute("title", /\((sgp|deu|usa1|ind1)\)$/);
        await expect(
          page.getByRole("button", {
            name: locale === "de-DE" ? "Anmelden" : "Sign in",
            exact: true,
          }),
        ).toBeDisabled();
      } finally {
        await context.close();
      }
    }
  });
}

test("a Hub sign-in uses only the chosen region and fails identically for wrong region and password", async ({
  context,
  hubUser,
  page,
}) => {
  const user = await hubUser("sgp");
  const hosts = recordRegionalAPIHosts(page);
  await page.goto(`${HUB_PORTAL}/login`);
  await chooseRegion(page, "deu");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const alert = page.getByRole("alert");
  const failure =
    "The email address or password is incorrect, or the selected region is wrong.";
  await expect(alert).toContainText(failure);
  expect(new Set(hosts)).toEqual(new Set(["deu.api.vetchium.localhost"]));
  await chooseRegion(page, "sgp");
  await expect(alert).toHaveCount(0);
  await page
    .getByLabel("Password", { exact: true })
    .fill(`Wrong!${user.password}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(alert).toContainText(failure);
  hosts.length = 0;
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
  expect(new Set(hosts)).toEqual(new Set(["sgp.api.vetchium.localhost"]));
  const next = await context.newPage();
  await next.goto(`${HUB_PORTAL}/login`);
  await expect(next.getByRole("button", { name: "Sign in" })).toBeDisabled();
});
