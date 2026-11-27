import type { Page } from "@playwright/test";
import { HubAPI } from "../lib/hub-api.ts";
import { HubBlocksAPI } from "../lib/hub-blocks.ts";
import { login } from "../lib/hub-signup.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  type HubTestUser,
  test,
} from "../lib/region-ui.ts";

/** Signs the user in through the portal's own form. */
async function signIn(page: Page, user: HubTestUser): Promise<void> {
  await page.goto(`${HUB_PORTAL}/login`);
  await chooseRegion(page, user.tenant);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
}

/** The block and mute API of the user's tenant, with a bearer token. */
async function apiFor(
  request: Parameters<typeof login>[0],
  user: HubTestUser,
): Promise<{ api: HubBlocksAPI; token: string }> {
  const token = await login(request, user.tenant, user.email, user.password);
  return { api: new HubBlocksAPI(new HubAPI(request, user.tenant)), token };
}

function menuButton(page: Page) {
  return page.getByRole("button", { name: "User actions" });
}

async function openProfile(page: Page, user: HubTestUser): Promise<void> {
  await page.goto(`${HUB_PORTAL}/u/${user.handle}`);
  await expect(menuButton(page)).toBeVisible();
}

test("the profile menu blocks after a confirmation and then offers Unblock", async ({
  page,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const other = await hubUser("sgp");
  await signIn(page, me);
  await openProfile(page, other);

  await menuButton(page).click();
  await page.getByRole("menuitem", { name: "Block", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: `Block @${other.handle}?`,
  });
  await expect(dialog).toContainText("Nobody is told about the block.");
  await dialog.getByRole("button", { name: "Block" }).click();
  await expect(page.getByText(`You blocked @${other.handle}.`)).toBeVisible();

  await menuButton(page).click();
  await expect(page.getByRole("menuitem", { name: "Unblock" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Block", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Unblock" }).click();
  await expect(page.getByText(`You unblocked @${other.handle}.`)).toBeVisible();
  await menuButton(page).click();
  await expect(
    page.getByRole("menuitem", { name: "Block", exact: true }),
  ).toBeVisible();
});

test("cancelling the block confirmation blocks nobody", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const other = await hubUser("sgp");
  await signIn(page, me);
  await openProfile(page, other);

  await menuButton(page).click();
  await page.getByRole("menuitem", { name: "Block", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: `Block @${other.handle}?`,
  });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  const { api, token } = await apiFor(request, me);
  const response = await api.state({ user: other.handle }, token);
  expect(await response.json()).toEqual({ blocked: false, muted: false });
  await menuButton(page).click();
  await expect(
    page.getByRole("menuitem", { name: "Block", exact: true }),
  ).toBeVisible();
});

test("the profile menu mutes and unmutes without a confirmation", async ({
  page,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const other = await hubUser("sgp");
  await signIn(page, me);
  await openProfile(page, other);

  await menuButton(page).click();
  await page.getByRole("menuitem", { name: "Mute", exact: true }).click();
  await expect(page.getByText(`You muted @${other.handle}.`)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await menuButton(page).click();
  await expect(page.getByRole("menuitem", { name: "Unmute" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Unmute" }).click();
  await expect(page.getByText(`You unmuted @${other.handle}.`)).toBeVisible();
  await menuButton(page).click();
  await expect(
    page.getByRole("menuitem", { name: "Mute", exact: true }),
  ).toBeVisible();
});

test("the profile menu is absent on one's own profile", async ({
  page,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  await signIn(page, me);
  await page.goto(`${HUB_PORTAL}/u/${me.handle}`);
  await expect(
    page.getByRole("link", { name: "Edit my profile" }),
  ).toBeVisible();
  await expect(menuButton(page)).toHaveCount(0);
});

test("a user in another region blocks and mutes across regions", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("usa1", { residentCountry: "US" });
  const other = await hubUser("sgp");
  await signIn(page, me);
  await openProfile(page, other);

  await menuButton(page).click();
  await page.getByRole("menuitem", { name: "Block", exact: true }).click();
  await page
    .getByRole("dialog", { name: `Block @${other.handle}?` })
    .getByRole("button", { name: "Block" })
    .click();
  await expect(page.getByText(`You blocked @${other.handle}.`)).toBeVisible();
  await menuButton(page).click();
  await page.getByRole("menuitem", { name: "Mute", exact: true }).click();
  await expect(page.getByText(`You muted @${other.handle}.`)).toBeVisible();

  const { api, token } = await apiFor(request, me);
  const response = await api.state({ user: other.handle }, token);
  expect(await response.json()).toEqual({ blocked: true, muted: true });
});

test("the blocks page shows empty states for a new user", async ({
  page,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  await signIn(page, me);
  await page.goto(`${HUB_PORTAL}/settings/blocks`);
  await expect(
    page.getByRole("heading", { name: "Blocks and mutes", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("You have not blocked anyone.")).toBeVisible();
  await expect(page.getByText("You have not muted anyone.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("the blocks page lists both kinds, loads more, and undoes each", async ({
  page,
  request,
  hubUser,
}) => {
  test.setTimeout(120_000);
  const me = await hubUser("sgp");
  const targets: HubTestUser[] = [];
  for (let i = 0; i < 21; i++) targets.push(await hubUser("sgp"));
  const muted = await hubUser("sgp");
  const { api, token } = await apiFor(request, me);
  for (const target of targets)
    expect((await api.block({ user: target.handle }, token)).status()).toBe(
      204,
    );
  expect((await api.mute({ user: muted.handle }, token)).status()).toBe(204);

  await signIn(page, me);
  await page.goto(`${HUB_PORTAL}/settings/blocks`);
  const blocked = page.locator(".ant-card", { hasText: "Blocked users" });
  const mutedCard = page.locator(".ant-card", { hasText: "Muted users" });
  await expect(blocked.locator(".ant-list-item")).toHaveCount(20);
  await expect(mutedCard.locator(".ant-list-item")).toHaveCount(1);
  await expect(mutedCard.getByRole("link")).toHaveText(`@${muted.handle}`);
  await blocked.getByRole("button", { name: "Load more" }).click();
  await expect(blocked.locator(".ant-list-item")).toHaveCount(21);
  await expect(blocked.getByRole("button", { name: "Load more" })).toHaveCount(
    0,
  );

  const first = targets[0]!;
  await blocked
    .getByRole("button", { name: `Unblock @${first.handle}` })
    .click();
  await expect(page.getByText(`You unblocked @${first.handle}.`)).toBeVisible();
  await expect(blocked.locator(".ant-list-item")).toHaveCount(20);
  await expect(
    blocked.getByRole("button", { name: `Unblock @${first.handle}` }),
  ).toHaveCount(0);

  await mutedCard
    .getByRole("button", { name: `Unmute @${muted.handle}` })
    .click();
  await expect(page.getByText(`You unmuted @${muted.handle}.`)).toBeVisible();
  await expect(page.getByText("You have not muted anyone.")).toBeVisible();
  const state = await api.state({ user: first.handle }, token);
  expect(await state.json()).toEqual({ blocked: false, muted: false });
});

test("a failed Unblock shows the error and keeps the row", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const other = await hubUser("sgp");
  const { api, token } = await apiFor(request, me);
  expect((await api.block({ user: other.handle }, token)).status()).toBe(204);

  await signIn(page, me);
  await page.route("**/api/hub/blocks/unblock", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      json: {
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
      },
    }),
  );
  await page.goto(`${HUB_PORTAL}/settings/blocks`);
  const undo = page.getByRole("button", { name: `Unblock @${other.handle}` });
  await undo.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(undo).toBeVisible();
  await expect(
    page.getByRole("link", { name: `@${other.handle}` }),
  ).toBeVisible();
  const state = await api.state({ user: other.handle }, token);
  expect(await state.json()).toEqual({ blocked: true, muted: false });
});

test("the blocks page needs a session", async ({ page }) => {
  await page.goto(`${HUB_PORTAL}/settings/blocks`);
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("heading", { name: "Blocks and mutes" }),
  ).toHaveCount(0);
});
