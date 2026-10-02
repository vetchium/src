import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  recordRegionalAPIHosts,
  test,
} from "../lib/region-ui.ts";

test("a signed-out visit to a profile signs in first, then shows a profile homed in another region", async ({
  hubUser,
  page,
}) => {
  const owner = await hubUser("usa1", { residentCountry: "US" });
  const viewer = await hubUser("sgp");
  const hosts = recordRegionalAPIHosts(page);

  await page.goto(`${HUB_PORTAL}/u/${owner.handle}`);
  await expect(page).toHaveURL(
    `${HUB_PORTAL}/login?returnTo=${encodeURIComponent(`/u/${owner.handle}`)}`,
  );
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

  await chooseRegion(page, "sgp");
  await page.getByLabel("Email address").fill(viewer.email);
  await page.getByLabel("Password", { exact: true }).fill(viewer.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(`${HUB_PORTAL}/u/${owner.handle}`);
  await expect(
    page.getByRole("heading", { name: owner.displayName }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );
  // The viewer's own region reads the remote profile over the mesh; the
  // browser never talks to the owner's region with the viewer's session.
  expect(new Set(hosts)).toEqual(new Set(["sgp.api.vetchium.localhost"]));
});
