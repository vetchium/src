import type { Page } from "@playwright/test";
import { HubAPI } from "../lib/hub-api.ts";
import { login } from "../lib/hub-signup.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  type HubTestUser,
  test,
} from "../lib/region-ui.ts";

const idealJobLabel = "My ideal job";
const lookingLabel = "Are you currently looking for a job?";

async function signIn(page: Page, user: HubTestUser) {
  await page.goto(`${HUB_PORTAL}/login?region=sgp`);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, "sgp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
}

async function openPreferences(page: Page) {
  await page.goto(`${HUB_PORTAL}/settings/preferences`);
  await expect(
    page.getByRole("heading", { name: "Preferences", level: 1 }),
  ).toBeVisible();
}

test("saving the Home job search card hides it until the ideal job is cleared (PROF-JOB-006, PROF-JOB-007)", async ({
  page,
  hubUser,
}) => {
  await signIn(page, await hubUser("sgp"));
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(page.getByLabel(idealJobLabel)).toBeVisible();
  await expect(
    page.getByText(
      "Shared with Orgs when you apply; used to find matching Openings.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Only you can see this. Orgs, agencies and other Hub users never do.",
    ),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(
    page.getByText("Describe your ideal job to save."),
  ).toBeVisible();
  await page.getByLabel(idealJobLabel).fill("   ");
  await expect(save).toBeDisabled();

  await page.getByLabel(idealJobLabel).fill("  Platform engineer\nRemote  ");
  await page.getByRole("switch", { name: lookingLabel }).click();
  await save.click();
  await expect(page.getByLabel(idealJobLabel)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Not now" })).toHaveCount(0);

  await openPreferences(page);
  await expect(page.getByLabel(idealJobLabel)).toHaveValue(
    "Platform engineer\nRemote",
  );
  await expect(page.getByRole("switch", { name: lookingLabel })).toBeChecked();

  await page.goto(`${HUB_PORTAL}/`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByLabel(idealJobLabel)).toHaveCount(0);

  await openPreferences(page);
  await page.getByLabel(idealJobLabel).fill("");
  await page.getByRole("button", { name: "Save ideal job" }).click();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  await page.goto(`${HUB_PORTAL}/`);
  await expect(page.getByLabel(idealJobLabel)).toHaveValue("");
  await expect(page.getByRole("switch", { name: lookingLabel })).toBeChecked();
});

test("Not now hides the Home job search card on every device (PROF-JOB-006)", async ({
  browser,
  page,
  hubUser,
}) => {
  const user = await hubUser("sgp");
  await signIn(page, user);
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByLabel(idealJobLabel)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByLabel(idealJobLabel)).toHaveCount(0);

  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await signIn(other, user);
    await expect(other.getByRole("button", { name: "Not now" })).toHaveCount(0);
    await expect(other.getByLabel(idealJobLabel)).toHaveCount(0);
  } finally {
    await context.close();
  }

  await openPreferences(page);
  await expect(page.getByLabel(idealJobLabel)).toHaveValue("");
});

test("Preferences edits the ideal job and the looking-for-a-job switch (PROF-JOB-007)", async ({
  page,
  hubUser,
}) => {
  await signIn(page, await hubUser("sgp"));
  await openPreferences(page);
  const idealJob = page.getByLabel(idealJobLabel);
  const save = page.getByRole("button", { name: "Save ideal job" });
  const discard = page.getByRole("button", { name: "Discard changes" });
  const looking = page.getByRole("switch", { name: lookingLabel });
  await expect(idealJob).toHaveValue("");
  await expect(save).toHaveCount(0);
  await expect(looking).not.toBeChecked();

  await idealJob.fill("Data engineer");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await discard.click();
  await expect(idealJob).toHaveValue("");
  await expect(save).toHaveCount(0);

  await idealJob.fill("😀".repeat(2001));
  await expect(
    page.getByText("Use no more than 2,000 characters."),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await idealJob.fill("😀".repeat(2000));
  await expect(
    page.getByText("Use no more than 2,000 characters."),
  ).toHaveCount(0);
  await expect(save).toBeEnabled();

  await idealJob.fill(" Data engineer ");
  await save.click();
  await expect(save).toHaveCount(0);
  await expect(idealJob).toHaveValue("Data engineer");

  await looking.click();
  await expect(looking).toBeChecked();
  await expect(looking).toBeEnabled();

  await page.reload();
  await expect(idealJob).toHaveValue("Data engineer");
  await expect(looking).toBeChecked();
  await looking.click();
  await expect(looking).not.toBeChecked();
  await expect(looking).toBeEnabled();
  await page.reload();
  await expect(looking).not.toBeChecked();

  await page.goto(`${HUB_PORTAL}/`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByLabel(idealJobLabel)).toHaveCount(0);
});

test("the job search helper texts render in German (PROF-JOB-008)", async ({
  page,
  request,
  hubUser,
}) => {
  const user = await hubUser("sgp");
  const token = await login(request, "sgp", user.email, user.password);
  const languageSet = await new HubAPI(request, "sgp").post(
    "/set-preferred-language",
    { preferred_language: "de-DE" },
    { token },
  );
  expect(languageSet.status(), await languageSet.text()).toBe(204);

  await signIn(page, user);
  const helpers = [
    "Wird bei einer Bewerbung mit Organisationen geteilt; dient zum Finden passender Stellen.",
    "Nur Sie können dies sehen. Organisationen, Agenturen und andere Hub-Nutzer sehen es nie.",
  ];
  await expect(page.getByLabel("Mein idealer Job")).toBeVisible();
  for (const helper of helpers) {
    await expect(page.getByText(helper)).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Nicht jetzt" })).toBeVisible();

  await page.goto(`${HUB_PORTAL}/settings/preferences`);
  await expect(
    page.getByRole("heading", { name: "Präferenzen", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Suchen Sie derzeit einen Job?" }),
  ).toBeVisible();
  for (const helper of helpers) {
    await expect(page.getByText(helper)).toBeVisible();
  }
});
