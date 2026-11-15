import type { Page } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { InternalServerError } from "typespec/problem/details";
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
            tags: [],
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

test("Opening cards and the Opening page show tags in the portal language", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const remote = await org("usa1");
  const api = new OrgsAPI(request, "usa1");
  const token = await loginOrg(api, remote);
  await publish(api, token, remote.emailAddress, {
    title: "Tagged engineer",
    description: "Build services.",
    language: "en",
    employing_country: "US",
    work_arrangement: "remote",
    remote_eligibility: { kind: "worldwide" },
    employment_type: "full_time",
    positions: 1,
    tags: ["human-resources", "golang"],
  });
  await signIn(page, await hubUser("sgp"));
  await page.goto(`${HUB_PORTAL}/org/${remote.domain}`);
  const card = page.getByRole("list", { name: "Tags" });
  await expect(card.getByRole("listitem")).toHaveText([
    "Human Resources",
    "Go",
  ]);

  await page.getByRole("combobox", { name: "Select language" }).click();
  await page.getByRole("option", { name: "Deutsch (Deutschland)" }).click();
  await expect(
    page.getByRole("list", { name: "Schlagwörter" }).getByRole("listitem"),
  ).toHaveText(["Personalwesen", "Go"]);

  // Human Resources has no Tamil name, so Tamil shows the default name.
  await page.getByRole("combobox", { name: "Sprache auswählen" }).click();
  await page.getByRole("option", { name: "தமிழ்" }).click();
  const tamilTags = page.getByRole("list", { name: "குறிச்சொற்கள்" });
  await expect(tamilTags.getByRole("listitem")).toHaveText([
    "Human Resources",
    "Go",
  ]);

  await page.getByRole("link", { name: "Tagged engineer" }).click();
  await expect(page.getByRole("article")).toBeVisible();
  await expect(tamilTags.getByRole("listitem")).toHaveText([
    "Human Resources",
    "Go",
  ]);
});

test("the Org page filters Openings by tag and keeps it across a reload", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const local = await org("sgp");
  const api = new OrgsAPI(request, "sgp");
  const token = await loginOrg(api, local);
  const content: OpeningContent = {
    title: "Plain role",
    description: "Build services.",
    language: "en",
    employing_country: "SG",
    work_arrangement: "on_site",
    employment_type: "full_time",
    positions: 1,
  };
  await publish(api, token, local.emailAddress, content);
  await publish(api, token, local.emailAddress, {
    ...content,
    title: "Tagged role",
    tags: ["golang"],
  });
  await signIn(page, await hubUser("sgp"));
  // A hand-edited tag the API would refuse is ignored, not sent.
  await page.goto(`${HUB_PORTAL}/org/${local.domain}?tag=Not_A_Tag`);
  await expect(page.getByRole("link", { name: "Tagged role" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Plain role" })).toBeVisible();
  // An Opening without tags shows no tag list.
  await expect(page.getByRole("list", { name: "Tags" })).toHaveCount(1);

  await page.getByRole("combobox", { name: "Tag", exact: true }).fill("go");
  await page
    .locator(".ant-select-dropdown:visible")
    .getByTitle("Go", { exact: true })
    .click();
  await expect(page).toHaveURL(/[?&]tag=golang/);
  await expect(page.getByRole("link", { name: "Tagged role" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Plain role" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("link", { name: "Tagged role" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Plain role" })).toHaveCount(0);
  // The filter shows the active tag after the reload.
  await expect(page.getByTitle("Go", { exact: true })).toBeVisible();
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

const plainContent: OpeningContent = {
  title: "Plain role",
  description: "Build services.",
  language: "en",
  employing_country: "SG",
  work_arrangement: "on_site",
  employment_type: "full_time",
  positions: 1,
};

test("a failed tag catalog read is shown in the Tag filter and tags show as OIDs", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const local = await org("sgp");
  const api = new OrgsAPI(request, "sgp");
  const token = await loginOrg(api, local);
  await publish(api, token, local.emailAddress, {
    ...plainContent,
    title: "Tagged role",
    tags: ["golang"],
  });
  await page.route("**/api/hub/list-opening-tags", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify(InternalServerError),
    }),
  );
  await signIn(page, await hubUser("sgp"));
  await page.goto(`${HUB_PORTAL}/org/${local.domain}`);
  await expect(page.getByRole("link", { name: "Tagged role" })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Tags" }).getByRole("listitem"),
  ).toHaveText(["golang"]);
  await expect(page.getByText("Tags could not be loaded")).toBeVisible();

  // A chosen tag hides the placeholder, so the open filter says it instead.
  await page.goto(`${HUB_PORTAL}/org/${local.domain}?tag=golang`);
  await expect(page.getByRole("link", { name: "Tagged role" })).toBeVisible();
  await page.getByRole("combobox", { name: "Tag", exact: true }).click();
  await expect(
    page.locator(".ant-select-dropdown:visible").getByRole("alert"),
  ).toHaveText("Tags could not be loaded");
});

test("moving to another Org's page starts with its own empty title search", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const api = new OrgsAPI(request, "sgp");
  const first = await org("sgp");
  const second = await org("sgp");
  await publish(api, await loginOrg(api, first), first.emailAddress, {
    ...plainContent,
    title: "Alpha role",
  });
  await publish(api, await loginOrg(api, second), second.emailAddress, {
    ...plainContent,
    title: "Beta role",
  });
  await signIn(page, await hubUser("sgp"));
  await page.goto(`${HUB_PORTAL}/org/${first.domain}`);
  const titleSearch = page.getByRole("searchbox", { name: "Search title" });
  await titleSearch.fill("Alpha");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/[?&]title=Alpha/);

  // A history step between two Org pages keeps the route mounted.
  await page.evaluate((path) => {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, `/org/${second.domain}`);
  await expect(page.getByRole("link", { name: "Beta role" })).toBeVisible();
  await expect(titleSearch).toHaveValue("");
});

test("an Opening card shows its salary when disclosed and none otherwise", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const local = await org("sgp");
  const api = new OrgsAPI(request, "sgp");
  const token = await loginOrg(api, local);
  await publish(api, token, local.emailAddress, {
    ...plainContent,
    title: "Paid role",
    salary: { currency: "SGD", min: 5000, max: 8000, period: "month" },
  });
  await publish(api, token, local.emailAddress, {
    ...plainContent,
    title: "Unstated role",
  });
  await signIn(page, await hubUser("sgp"));
  await page.goto(`${HUB_PORTAL}/org/${local.domain}`);
  await expect(page.getByRole("link", { name: "Paid role" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Unstated role" })).toBeVisible();
  // Two cards, one salary: the card without one shows none.
  await expect(page.getByText(/^SGD /)).toHaveText([
    "SGD 5,000–8,000 per month",
  ]);
  // The Org page names the Org once, in its header, not on every card.
  await expect(page.getByRole("link", { name: "Playwright Org" })).toHaveCount(
    0,
  );
});
