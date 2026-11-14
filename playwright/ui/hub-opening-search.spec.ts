import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { SearchOpeningsRequest } from "typespec/hub/openings/search";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { RegionUnavailableError } from "typespec/problem/hub/openings";
import { loginOrg, OrgsAPI } from "../lib/orgs-api.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseOption,
  chooseRegion,
  expect,
  expectSelectedRegion,
  type OrgTestOrg,
  searchAndChooseOption,
  test,
} from "../lib/region-ui.ts";

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

/** A word no other test puts in a title, so a search sees only this test's
 * Openings among everything the shared stack holds. */
function token(): string {
  return `t${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function content(
  title: string,
  overrides: Partial<OpeningContent> = {},
): OpeningContent {
  return {
    title,
    description: "Build reliable services.",
    language: "en",
    employing_country: "SG",
    work_arrangement: "on_site",
    employment_type: "full_time",
    positions: 1,
    ...overrides,
  };
}

async function publish(
  api: OrgsAPI,
  org: OrgTestOrg,
  openings: OpeningContent[],
): Promise<OrgOpening[]> {
  const token = await loginOrg(api, org);
  const published: OrgOpening[] = [];
  for (const opening of openings) {
    const created = await api.createOpening(token, {
      content: opening,
      hiring_manager_email: org.emailAddress,
      recruiter_email: org.emailAddress,
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
    published.push((await response.json()) as OrgOpening);
  }
  return published;
}

/** Records the body of every search the page sends. */
function recordSearches(page: Page): SearchOpeningsRequest[] {
  const bodies: SearchOpeningsRequest[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/hub/search-openings"))
      bodies.push(request.postDataJSON() as SearchOpeningsRequest);
  });
  return bodies;
}

function opening(page: Page, title: string) {
  return page.getByRole("link", { name: title, exact: true });
}

test.describe.configure({ timeout: 90_000 });

test("the Openings navigation entry opens the search in the session's region", async ({
  hubUser,
  page,
}) => {
  await signIn(page, await hubUser("sgp"));
  await page.getByRole("menuitem", { name: "Openings" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/openings`);
  await expect(
    page.getByRole("heading", { name: "Openings", level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Openings | Vetchium");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );
  await expectSelectedRegion(page, "sgp");
});

test("keyword, tag, country, arrangement, and salary filters narrow results and survive reload and back", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const local = await org("sgp");
  const word = token();
  const [, remote] = await publish(new OrgsAPI(request, "sgp"), local, [
    content(`${word} Go developer`, {
      tags: ["golang"],
      salary: { currency: "SGD", min: 5000, max: 8000, period: "month" },
    }),
    content(`${word} Remote writer`, {
      employing_country: "US",
      work_arrangement: "remote",
      remote_eligibility: { kind: "worldwide" },
      employment_type: "part_time",
    }),
    content(`${word} Hybrid analyst`, {
      employing_country: "US",
      work_arrangement: "hybrid",
      employment_type: "contract",
    }),
  ]);
  const go = `${word} Go developer`;
  const writer = `${word} Remote writer`;
  const analyst = `${word} Hybrid analyst`;
  await signIn(page, await hubUser("sgp"));

  await page.goto(`${HUB_PORTAL}/openings`);
  await page.getByRole("searchbox", { name: "Keyword" }).fill(word);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/openings?q=${word}`);
  for (const title of [go, writer, analyst])
    await expect(opening(page, title)).toBeVisible();
  await expect(page.getByText("SGD 5,000–8,000 per month")).toHaveCount(1);

  // A keyword of one character is refused beside the box and never sent.
  await page.getByRole("searchbox", { name: "Keyword" }).fill("x");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Enter 2 to 200 characters.")).toBeVisible();
  await expect(page).toHaveURL(`${HUB_PORTAL}/openings?q=${word}`);

  await page.getByRole("button", { name: "More filters" }).click();
  await searchAndChooseOption(
    page,
    page.getByRole("combobox", { name: "Tags" }),
    "Go",
  );
  await expect(page).toHaveURL(/[?&]tag=golang/);
  await expect(opening(page, go)).toBeVisible();
  await expect(opening(page, writer)).toHaveCount(0);
  await page.reload();
  await expect(opening(page, go)).toBeVisible();
  await expect(opening(page, analyst)).toHaveCount(0);
  await expect(page.getByTitle("Go", { exact: true })).toBeVisible();

  // Where the user may work matches on-site Openings employed there and
  // remote Openings open worldwide.
  await page.goto(`${HUB_PORTAL}/openings?q=${word}`);
  await page.getByRole("button", { name: "More filters" }).click();
  await searchAndChooseOption(
    page,
    page.getByRole("combobox", { name: "Where you may work" }),
    "Singapore",
  );
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/[?&]country=SG/);
  await expect(opening(page, go)).toBeVisible();
  await expect(opening(page, writer)).toBeVisible();
  await expect(opening(page, analyst)).toHaveCount(0);
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "Work arrangement" }),
    "Remote",
  );
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(
    `${HUB_PORTAL}/openings?q=${word}&country=SG&arrangement=remote`,
  );
  await expect(opening(page, writer)).toBeVisible();
  await expect(opening(page, go)).toHaveCount(0);
  await page.reload();
  await expect(opening(page, writer)).toBeVisible();
  await expect(opening(page, go)).toHaveCount(0);
  await opening(page, writer).click();
  await expect(page).toHaveURL(
    `${HUB_PORTAL}/org/${local.domain}/openings/${remote?.opening_number}`,
  );
  await page.goBack();
  await expect(page).toHaveURL(
    `${HUB_PORTAL}/openings?q=${word}&country=SG&arrangement=remote`,
  );
  await expect(opening(page, writer)).toBeVisible();
  await expect(opening(page, go)).toHaveCount(0);

  await page.goto(`${HUB_PORTAL}/openings?q=${word}`);
  await page.getByRole("button", { name: "More filters" }).click();
  await page
    .getByRole("switch", { name: "Only openings that show a salary" })
    .click();
  await expect(page).toHaveURL(/[?&]salary=1/);
  await expect(opening(page, go)).toBeVisible();
  await expect(opening(page, writer)).toHaveCount(0);
  await expect(opening(page, analyst)).toHaveCount(0);
  await page.reload();
  await expect(opening(page, go)).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Only openings that show a salary" }),
  ).toBeChecked();
});

test("hand-edited values the API would refuse are dropped, not sent", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const local = await org("sgp");
  const word = token();
  await publish(new OrgsAPI(request, "sgp"), local, [
    content(`${word} Plain role`),
  ]);
  await signIn(page, await hubUser("sgp"));
  const searches = recordSearches(page);
  await page.goto(
    `${HUB_PORTAL}/openings?q=${word}&tag=Not_A_Tag&country=XX&arrangement=office&posted=3&experience=abc&education=phd&salary=yes&region=gone`,
  );
  await expect(opening(page, `${word} Plain role`)).toBeVisible();
  expect(searches).toEqual([{ keyword: word }]);
  await expectSelectedRegion(page, "sgp");
});

test("the Org typeahead suggests and filters, clears on a region change, and another region shows its Openings", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const word = token();
  const sgp = new OrgsAPI(request, "sgp");
  const first = await org("sgp");
  const second = await org("sgp");
  const remote = await org("usa1");
  await publish(sgp, first, [content(`${word} Alpha`)]);
  await publish(sgp, second, [content(`${word} Beta`)]);
  const [remoteOpening] = await publish(new OrgsAPI(request, "usa1"), remote, [
    content(`${word} Remote`, {
      employing_country: "US",
      work_arrangement: "remote",
      remote_eligibility: { kind: "worldwide" },
    }),
  ]);
  await signIn(page, await hubUser("sgp"));
  await page.goto(`${HUB_PORTAL}/openings?q=${word}`);
  await expect(opening(page, `${word} Alpha`)).toBeVisible();
  await expect(opening(page, `${word} Beta`)).toBeVisible();
  await expect(opening(page, `${word} Remote`)).toHaveCount(0);

  await page.getByRole("button", { name: "More filters" }).click();
  await page.getByRole("combobox", { name: "Organization" }).fill(first.domain);
  await page
    .locator(".ant-select-dropdown:visible")
    .getByTitle(`Playwright Org (${first.domain})`, { exact: true })
    .click();
  await expect(page).toHaveURL(
    `${HUB_PORTAL}/openings?q=${word}&org=${first.domain}`,
  );
  await expect(opening(page, `${word} Alpha`)).toBeVisible();
  await expect(opening(page, `${word} Beta`)).toHaveCount(0);

  await chooseRegion(page, "usa1");
  await expect(page).toHaveURL(`${HUB_PORTAL}/openings?q=${word}&region=usa1`);
  await expect(opening(page, `${word} Remote`)).toBeVisible();
  await expect(opening(page, `${word} Alpha`)).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Organization" }).locator(".."),
  ).not.toHaveAttribute("title", /./);

  // The card links to the Org page and the Opening page.
  await page.getByRole("link", { name: "Playwright Org" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/org/${remote.domain}`);
  await page.goBack();
  await expect(page).toHaveURL(`${HUB_PORTAL}/openings?q=${word}&region=usa1`);
  await expectSelectedRegion(page, "usa1");
  await opening(page, `${word} Remote`).click();
  await expect(page).toHaveURL(
    `${HUB_PORTAL}/org/${remote.domain}/openings/${remoteOpening?.opening_number}`,
  );
  await expect(
    page.getByRole("heading", { name: `${word} Remote` }),
  ).toBeVisible();
});

test("results page forward and back, and a filter change restarts at the first page", async ({
  hubUser,
  page,
}) => {
  await signIn(page, await hubUser("sgp"));
  const bodies: SearchOpeningsRequest[] = [];
  await page.route("**/api/hub/search-openings", (route) => {
    const body = route.request().postDataJSON() as SearchOpeningsRequest;
    bodies.push(body);
    const secondPage = body.pagination_key === "next-page";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        openings: [
          {
            org: {
              domain: "pages.example.com",
              display_name: "Page Org",
              country: "SG",
            },
            opening: {
              opening_number: secondPage ? 2 : 1,
              title: secondPage ? "Second opening" : "First opening",
              employing_country: "SG",
              work_arrangement: "hybrid",
              employment_type: "full_time",
              first_published_at: "2026-01-01T00:00:00Z",
              tags: [],
            },
          },
        ],
        ...(secondPage ? {} : { next_pagination_key: "next-page" }),
      }),
    });
  });
  await page.goto(`${HUB_PORTAL}/openings`);
  await expect(opening(page, "First opening")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(opening(page, "Second opening")).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(opening(page, "First opening")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(opening(page, "Second opening")).toBeVisible();
  await page.getByRole("searchbox", { name: "Keyword" }).fill("engineer");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(opening(page, "First opening")).toBeVisible();
  // Pages already read come from the cache, so only new reads are sent.
  expect(bodies).toEqual([
    {},
    { pagination_key: "next-page" },
    { keyword: "engineer" },
  ]);
});

test("a search without results offers to clear filters, and an unavailable region is named", async ({
  hubUser,
  page,
}) => {
  await signIn(page, await hubUser("sgp"));
  await page.goto(`${HUB_PORTAL}/openings?q=${token()}`);
  await expect(page.getByText("No openings match this search.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/openings`);
  await expect(page.getByRole("searchbox", { name: "Keyword" })).toHaveValue(
    "",
  );

  // CI's ind1 always answers, so its unavailability is simulated.
  await page.route("**/api/hub/search-openings", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify(RegionUnavailableError),
    }),
  );
  await page.goto(`${HUB_PORTAL}/openings?region=ind1`);
  await expect(
    page.getByText(
      "The India (ind1) region is not answering. Try again later or choose another region.",
    ),
  ).toBeVisible();
});

test("result cards show tags in the portal language", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const local = await org("sgp");
  const word = token();
  await publish(new OrgsAPI(request, "sgp"), local, [
    content(`${word} People partner`, { tags: ["human-resources", "golang"] }),
  ]);
  await signIn(page, await hubUser("sgp"));
  await page.goto(`${HUB_PORTAL}/openings?q=${word}`);
  await expect(
    page.getByRole("list", { name: "Tags" }).getByRole("listitem"),
  ).toHaveText(["Human Resources", "Go"]);
  await page.getByRole("combobox", { name: "Select language" }).click();
  await page.getByRole("option", { name: "Deutsch (Deutschland)" }).click();
  await expect(
    page.getByRole("heading", { name: "Stellen", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Schlagwörter" }).getByRole("listitem"),
  ).toHaveText(["Personalwesen", "Go"]);
});

test("the Home search box opens Opening search with its keyword, or unfiltered when empty", async ({
  hubUser,
  org,
  page,
  request,
}) => {
  const local = await org("sgp");
  const word = token();
  await publish(new OrgsAPI(request, "sgp"), local, [
    content(`${word} Home role`),
  ]);
  await signIn(page, await hubUser("sgp"));
  const box = page.getByRole("searchbox", { name: "Search openings" });
  await box.fill(` ${word} `);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/openings?q=${word}`);
  await expect(opening(page, `${word} Home role`)).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Keyword" })).toHaveValue(
    word,
  );

  await page.getByRole("menuitem", { name: "Home" }).click();
  await box.fill("x");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Enter 2 to 200 characters.")).toBeVisible();
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
  await box.fill("");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/openings`);
  await expect(page.getByRole("searchbox", { name: "Keyword" })).toHaveValue(
    "",
  );
});
