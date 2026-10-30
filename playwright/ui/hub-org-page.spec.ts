import type { Page } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { loginOrg, OrgsAPI } from "../lib/orgs-api.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import { chooseOption, chooseRegion, expect, test } from "../lib/region-ui.ts";

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto(`${HUB_PORTAL}/login?region=sgp`);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, "sgp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
}

async function publish(
  api: OrgsAPI,
  token: string,
  email: string,
  content: OpeningContent,
) {
  const created = await api.createOpening(token, {
    content,
    hiring_manager_email: email,
    recruiter_email: email,
    team_member_emails: [],
  });
  expect(created.status(), await created.text()).toBe(201);
  const draft = (await created.json()) as OrgOpening;
  const response = await api.requestOpeningChange(token, {
    opening_number: draft.opening_number,
    version: draft.version,
    kind: "publish",
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as OrgOpening;
}

test.describe.configure({ timeout: 90_000 });

test("signed-out Org and Opening URLs return to the same page after sign-in", async ({
  hubUser,
  page,
}) => {
  const user = await hubUser("sgp");
  const target = "/org/example.com/openings/1";
  await page.goto(`${HUB_PORTAL}${target}`);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(target);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, "sgp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}${target}`);
  await expect(page.getByText("Opening not found.")).toBeVisible();
});

test("Hub user browses a remote Org, filters Openings, and sees safe published and closed details", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const user = await hubUser("sgp");
  const remote = await org("usa1");
  const api = new OrgsAPI(request, "usa1");
  const token = await loginOrg(api, remote);
  const content: OpeningContent = {
    title: "Remote engineer",
    description: "**Build services** <script>bad</script>",
    language: "en",
    employing_country: "US",
    work_arrangement: "remote",
    remote_eligibility: { kind: "worldwide" },
    employment_type: "full_time",
    positions: 1,
  };
  await publish(api, token, remote.emailAddress, content);
  const closed = await publish(api, token, remote.emailAddress, {
    ...content,
    title: "Closed engineer",
  });
  const close = await api.requestOpeningChange(token, {
    opening_number: closed.opening_number,
    version: closed.version,
    kind: "close",
  });
  expect(close.status(), await close.text()).toBe(200);
  await signIn(page, user);
  await page.goto(`${HUB_PORTAL}/org/${remote.domain}`);
  await expect(
    page.getByRole("heading", { name: "Playwright Org" }),
  ).toBeVisible();
  await expect(
    page.getByText(`${remote.domain} · Based in Singapore`),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Remote engineer" }),
  ).toBeVisible();
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "Work arrangement" }),
    "Remote",
  );
  await page.getByRole("combobox", { name: "Country" }).fill("United States");
  await page
    .locator(".ant-select-dropdown:visible")
    .getByTitle("United States", { exact: true })
    .click();
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "Employment type" }),
    "Full time",
  );
  await expect(
    page.getByRole("link", { name: "Remote engineer" }),
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "Search title" }).fill("zzzz");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByText("No openings match these filters."),
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "Search title" }).fill("Remote");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByRole("link", { name: "Remote engineer" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Remote engineer" }).click();
  await expect(
    page.getByRole("article").getByText("Build services"),
  ).toBeVisible();
  await expect(page.locator("script", { hasText: "bad" })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );
  await page.goto(
    `${HUB_PORTAL}/org/${remote.domain}/openings/${closed.opening_number}`,
  );
  await expect(
    page.getByText("This opening is not accepting applications."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Closed engineer" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.goto(`${HUB_PORTAL}/org/${remote.domain}/openings/99999`);
  await expect(page.getByText("Opening not found.")).toBeVisible();
});

test("Opening list follows and returns through keyset pages", async ({
  hubUser,
  page,
}) => {
  await signIn(page, await hubUser("sgp"));
  const keys: (string | undefined)[] = [];
  await page.route("**/api/hub/list-org-openings", (route) => {
    const body = route.request().postDataJSON() as { pagination_key?: string };
    keys.push(body.pagination_key);
    const secondPage = body.pagination_key === "next-page";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        org: {
          domain: "pages.example.com",
          display_name: "Page Org",
          country: "SG",
        },
        openings: [
          {
            opening_number: secondPage ? 2 : 1,
            title: secondPage ? "Second opening" : "First opening",
            employing_country: "SG",
            work_arrangement: "hybrid",
            employment_type: "full_time",
            first_published_at: "2026-01-01T00:00:00Z",
          },
        ],
        ...(secondPage ? {} : { next_pagination_key: "next-page" }),
      }),
    });
  });
  await page.goto(`${HUB_PORTAL}/org/pages.example.com`);
  await expect(page.getByRole("link", { name: "First opening" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );
  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByRole("link", { name: "Second opening" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("link", { name: "First opening" })).toBeVisible();
  expect(keys).toEqual([undefined, "next-page"]);
});

test("unknown and unavailable Orgs show distinct messages", async ({
  hubUser,
  page,
}) => {
  await signIn(page, await hubUser("sgp"));
  await page.goto(`${HUB_PORTAL}/org/example.com`);
  await expect(page.getByText("Organization not found.")).toBeVisible();
  await page.route("**/api/hub/list-org-openings", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "vetchium-problem-details/hub-org-unavailable",
        title: "Org unavailable",
        status: 503,
      }),
    }),
  );
  await page.goto(`${HUB_PORTAL}/org/unavailable.example.com`);
  await expect(
    page.getByText("This organization is temporarily unavailable. Try again."),
  ).toBeVisible();
});
