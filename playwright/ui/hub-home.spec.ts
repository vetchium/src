import { expect, type Page, test } from "@playwright/test";
import type { PublicOpeningSummary } from "typespec/hub/openings/public";
import type {
  OpeningSearchResult,
  SearchOpeningsRequest,
} from "typespec/hub/openings/search";
import { IdealJobMissingError } from "typespec/problem/hub/openings";
import { stubShellReads } from "../lib/hub-ui-stubs.ts";
import { HUB_PORTAL } from "../lib/portals.ts";

const handle = "perso000-00000000001";

interface HomeState {
  idealJob?: string;
  awaitingAnswer?: number;
}

/** An everyday Home: setup was hidden. */
async function stubHome(page: Page, state: HomeState = {}) {
  await stubShellReads(page);
  await page.addInitScript((userHandle) => {
    sessionStorage.setItem(
      "vetchium.hub.session",
      JSON.stringify({
        tenantId: "sgp",
        session: {
          session_token: "s".repeat(64),
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
          preferred_language: "en-US",
          resident_country: "SG",
          handle: userHandle,
          remembered: false,
        },
      }),
    );
  }, handle);
  await page.route("**/api/hub/my-info", (route) =>
    route.fulfill({
      json: {
        handle,
        email_address: "person@example.com",
        display_name: "Example Person",
        preferred_language: "en-US",
        resident_country: "SG",
        preferred_job_countries: ["SG"],
        totp_enabled: true,
        recovery_codes_remaining: 10,
        session_authenticated_at: new Date().toISOString(),
        ideal_job: state.idealJob,
        looking_for_job: false,
        job_search_prompt_dismissed: true,
      },
    }),
  );
  await page.route("**/api/hub/my-subscription", (route) =>
    route.fulfill({
      json: { plan_oid: "hub-free-tier", cancel_at_period_end: false },
    }),
  );
  await page.route("**/api/hub/opening-tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.route("**/api/hub/my-application-counts", (route) =>
    route.fulfill({
      json: {
        active: state.awaitingAnswer ?? 0,
        closed: 0,
        awaiting_answer: state.awaitingAnswer ?? 0,
      },
    }),
  );
  await page.route("**/api/hub/profile/read", (route) =>
    route.fulfill({
      json: {
        display_name: "Example Person",
        handle,
        resident_country: "SG",
        websites: [],
        work_experiences: [],
        educational_qualifications: [],
        certifications: [],
        language_abilities: [],
      },
    }),
  );
}

function match(number: number): OpeningSearchResult {
  return {
    org: {
      domain: "northwind.example",
      display_name: "Northwind",
      country: "SG",
    },
    opening: {
      opening_number: number,
      title: `Match ${number}`,
      employing_country: "SG",
      work_arrangement: "remote",
      employment_type: "full_time",
      tags: [],
      first_published_at: "2026-11-01T00:00:00Z",
    } satisfies PublicOpeningSummary,
  };
}

test("everyday Home previews the first three matches of the home region", async ({
  page,
}) => {
  await stubHome(page, { idealJob: "Platform engineer" });
  const searches: SearchOpeningsRequest[] = [];
  await page.route("**/api/hub/search-openings", async (route) => {
    searches.push(route.request().postDataJSON() as SearchOpeningsRequest);
    await route.fulfill({ json: { openings: [1, 2, 3, 4].map(match) } });
  });
  await page.goto(HUB_PORTAL);
  await expect(
    page.getByRole("heading", { name: "Hello, Example Person" }),
  ).toBeVisible();
  for (const number of [1, 2, 3]) {
    await expect(
      page.getByRole("link", { name: `Match ${number}` }),
    ).toHaveAttribute("href", `/org/northwind.example/openings/${number}`);
  }
  await expect(page.getByText("Match 4")).toHaveCount(0);
  await expect(
    page.getByText("Northwind · Singapore · Remote").first(),
  ).toBeVisible();
  // The home region, and never the ideal job's text.
  expect(searches).toEqual([{ sort: "ideal_job_match" }]);
  await page.getByRole("link", { name: "See all" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/openings?sort=match`);
});

test("everyday Home says when nothing matches", async ({ page }) => {
  await stubHome(page, { idealJob: "Platform engineer" });
  await page.route("**/api/hub/search-openings", (route) =>
    route.fulfill({ json: { openings: [] } }),
  );
  await page.goto(HUB_PORTAL);
  await expect(
    page.getByText("No matching Openings in your region yet."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "See all" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Browse Openings" }),
  ).toHaveAttribute("href", "/openings");
});

test("failed matches can be retried", async ({ page }) => {
  await stubHome(page, { idealJob: "Platform engineer" });
  let fail = true;
  await page.route("**/api/hub/search-openings", (route) =>
    fail
      ? route.fulfill({ status: 500 })
      : route.fulfill({ json: { openings: [match(1)] } }),
  );
  await page.goto(HUB_PORTAL);
  await expect(page.getByRole("alert")).toContainText(
    "Something went wrong. Please try again.",
  );
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("link", { name: "Match 1" })).toBeVisible();
});

test("an ideal job removed elsewhere offers adding one", async ({ page }) => {
  await stubHome(page, { idealJob: "Platform engineer" });
  await page.route("**/api/hub/search-openings", (route) =>
    route.fulfill({
      status: IdealJobMissingError.status,
      contentType: "application/problem+json",
      json: IdealJobMissingError,
    }),
  );
  await page.goto(HUB_PORTAL);
  await expect(
    page.getByRole("link", { name: "Add your ideal job" }),
  ).toHaveAttribute("href", "/settings/preferences");
});

test("without an ideal job Home asks for one and searches nothing", async ({
  page,
}) => {
  await stubHome(page);
  let searches = 0;
  await page.route("**/api/hub/search-openings", async (route) => {
    searches += 1;
    await route.fulfill({ json: { openings: [] } });
  });
  await page.goto(HUB_PORTAL);
  await expect(
    page.getByText("Say what you're looking for to see Openings that fit."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Add your ideal job" }),
  ).toBeVisible();
  expect(searches).toBe(0);
});

test("applications waiting on the user lead Home", async ({ page }) => {
  await stubHome(page, { awaitingAnswer: 2 });
  await page.route("**/api/hub/my-applications", (route) =>
    route.fulfill({ json: { applications: [] } }),
  );
  await page.goto(HUB_PORTAL);
  await expect(
    page.getByText("2 applications are waiting for your answer"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Answer", exact: true }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/applications?awaiting=1`);
});

test("a profile that cannot load keeps the search and offers a retry", async ({
  page,
}) => {
  await stubHome(page);
  let fail = true;
  await page.route("**/api/hub/profile/read", (route) =>
    fail ? route.fulfill({ status: 500 }) : route.fallback(),
  );
  await page.goto(HUB_PORTAL);
  await expect(page.getByRole("alert")).toContainText(
    "Something went wrong. Please try again.",
  );
  await expect(
    page.getByRole("searchbox", { name: "Search openings" }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Your profile", { exact: true })).toBeVisible();
});
