import type { Page } from "@playwright/test";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import { HubAPI } from "../lib/hub-api.ts";
import { login } from "../lib/hub-signup.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  cleanupBrowserIdempotency,
  expect,
  type HubTestUser,
  searchAndChooseOption,
  test,
} from "../lib/region-ui.ts";

// Ledger operations of the profile routes setup writes to.
const profileOperations: Record<string, string> = {
  "add-language": "add-language-ability",
  "save-education": "save-education",
  "save-work-experience": "save-work-experience",
  "set-public-fields": "set-public-fields",
};
const idealJobLabel = "My ideal job";
const lookingLabel = "I'm looking for a job now";

const idealJobField = (page: Page) =>
  page.getByRole("textbox", { name: idealJobLabel });
const lookingBox = (page: Page) =>
  page.getByRole("checkbox", { name: lookingLabel });
const saveAndContinue = (page: Page) =>
  page.getByRole("button", { name: "Save and continue" }).click();
const skip = (page: Page) =>
  page.getByRole("button", { name: "Skip", exact: true });
const step = (page: Page, title: string) =>
  page.getByRole("button", { name: new RegExp(title) });
const heading = (page: Page, name: string) =>
  page.getByRole("heading", { name, exact: true });

async function signIn(page: Page, user: HubTestUser) {
  await page.goto(`${HUB_PORTAL}/login?region=sgp`);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, "sgp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function openPreferences(page: Page) {
  await page.goto(`${HUB_PORTAL}/settings/preferences`);
  await expect(
    page.getByRole("heading", { name: "Preferences", level: 1 }),
  ).toBeVisible();
}

test("setup greets a new user with the ideal job first and no promotions (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  const user = await hubUser("sgp");
  await signIn(page, user);
  await expect(heading(page, `Welcome, ${user.displayName}`)).toBeVisible();
  await expect(heading(page, "What's your ideal job?")).toBeVisible();
  await expect(page.getByText("0 of 5 done")).toBeVisible();
  await expect(
    page.getByText("Not on your profile", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("On your profile", { exact: true })).toHaveCount(
    4,
  );
  await expect(page.getByRole("link", { name: "See plans" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Turn on 2FA" })).toHaveCount(0);
  await expect(
    page.getByRole("searchbox", { name: "Search openings" }),
  ).toBeVisible();

  await page.getByRole("button", { name: `About ${idealJobLabel}` }).click();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Not on your profile. Shared with companies when you apply.",
  );
});

test("saving the ideal job moves setup on until the ideal job is cleared (PROF-JOB-006, PROF-JOB-007)", async ({
  page,
  hubUser,
}) => {
  await signIn(page, await hubUser("sgp"));
  await saveAndContinue(page);
  await expect(page.getByText("Describe your ideal job first.")).toBeVisible();
  await idealJobField(page).fill("   ");
  await saveAndContinue(page);
  await expect(page.getByText("Describe your ideal job first.")).toBeVisible();

  await idealJobField(page).fill("  Platform engineer\nRemote  ");
  await lookingBox(page).check();
  await saveAndContinue(page);
  await expect(heading(page, "Where have you worked?")).toBeFocused();
  await expect(page.getByText("1 of 5 done")).toBeVisible();

  await openPreferences(page);
  await expect(idealJobField(page)).toHaveValue("Platform engineer\nRemote");
  await expect(page.getByRole("switch", { name: lookingLabel })).toBeChecked();

  await page.goto(`${HUB_PORTAL}/`);
  await expect(heading(page, "Where have you worked?")).toBeVisible();
  await expect(idealJobField(page)).toHaveCount(0);
  await step(page, "Ideal job").click();
  await expect(idealJobField(page)).toHaveValue("Platform engineer\nRemote");

  await openPreferences(page);
  await idealJobField(page).fill("");
  await page.getByRole("button", { name: "Save ideal job" }).click();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  await page.goto(`${HUB_PORTAL}/`);
  await expect(idealJobField(page)).toHaveValue("");
  await expect(lookingBox(page)).toBeChecked();
});

test("looking for a job saves without an ideal job (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  await signIn(page, await hubUser("sgp"));
  const idealJobWrites: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/hub/set-ideal-job")) {
      idealJobWrites.push(request.url());
    }
  });
  await lookingBox(page).check();
  await saveAndContinue(page);
  await expect(heading(page, "Where have you worked?")).toBeFocused();
  await expect(page.getByText("0 of 5 done")).toBeVisible();
  expect(idealJobWrites).toEqual([]);
  await page.reload();
  await expect(idealJobField(page)).toHaveValue("");
  await expect(lookingBox(page)).toBeChecked();
});

test("a failed setup save keeps the step and what was typed (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  await signIn(page, await hubUser("sgp"));
  await page.route("**/api/hub/set-ideal-job", (route) =>
    route.fulfill({ status: 500 }),
  );
  await idealJobField(page).fill("Platform engineer");
  await saveAndContinue(page);
  await expect(page.getByRole("alert")).toContainText(
    "Something went wrong. Please try again.",
  );
  await expect(heading(page, "What's your ideal job?")).toBeVisible();
  await expect(idealJobField(page)).toHaveValue("Platform engineer");
});

test("every step is filled in on Home, and the last one opens everyday Home (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  const user = await hubUser("sgp");
  const written: { operation: string; key: string }[] = [];
  page.on("request", (request) => {
    const route = request.url().split("/api/hub/profile/")[1];
    const operation = profileOperations[route ?? ""];
    const key = request.headers()["idempotency-key"];
    if (operation !== undefined && key !== undefined) {
      written.push({ operation, key });
    }
  });
  try {
    await signIn(page, user);
    await idealJobField(page).fill(`Engineer ${user.handle}`);
    await saveAndContinue(page);

    await expect(heading(page, "Where have you worked?")).toBeFocused();
    await saveAndContinue(page);
    await expect(
      page.getByText("Enter just the domain, such as acme.com."),
    ).toBeVisible();
    await expect(page.getByText("Choose when you started.")).toBeVisible();
    await page.getByRole("textbox", { name: "Job title" }).fill("Engineer");
    await page
      .getByRole("textbox", { name: "Employer's website", exact: true })
      .fill("Example.COM");
    await page.getByRole("textbox", { name: "Started" }).click();
    await page
      .locator(".ant-picker-dropdown:visible")
      .locator(".ant-picker-cell-in-view:not(.ant-picker-cell-disabled)")
      .first()
      .click();
    await page
      .getByRole("button", { name: "Location and description" })
      .click();
    await page.getByRole("textbox", { name: "Location" }).fill("Singapore");
    await saveAndContinue(page);

    await expect(heading(page, "Where did you study?")).toBeFocused();
    await expect(page.getByText("2 of 5 done")).toBeVisible();
    await saveAndContinue(page);
    await expect(
      page.getByText("Enter just the domain, such as example.edu."),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "Degree" }).fill("BSc");
    await page
      .getByRole("textbox", { name: "Institution's website", exact: true })
      .fill("example.edu");
    await saveAndContinue(page);

    await expect(heading(page, "Which languages do you use?")).toBeFocused();
    const next = page.getByRole("button", { name: "Continue", exact: true });
    await expect(next).toHaveCount(0);
    await searchAndChooseOption(
      page,
      page.getByRole("combobox", { name: "Speaking" }),
      "English",
    );
    await page.keyboard.press("Escape");
    await next.click();

    await expect(heading(page, "Introduce yourself")).toBeFocused();
    await expect(page.getByText("4 of 5 done")).toBeVisible();
    // Nothing is left to skip to.
    await expect(skip(page)).toHaveCount(0);
    await saveAndContinue(page);
    await expect(
      page.getByText("Write a line about yourself first."),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Biography" })
      .fill("I keep services running.");
    await saveAndContinue(page);

    await expect(heading(page, `Hello, ${user.displayName}`)).toBeFocused();
    await expect(page.getByText("You're all set up.")).toBeVisible();
    await expect(page.getByText("Ready to apply")).toBeVisible();
    await expect(page.getByText("Matches for your ideal job")).toBeVisible();

    await page.reload();
    await expect(heading(page, `Hello, ${user.displayName}`)).toBeVisible();
    await page.getByRole("link", { name: "View as others see it" }).click();
    // Saving the biography sent the name unchanged.
    await expect(heading(page, user.displayName)).toBeVisible();
    await expect(page.getByText("I keep services running.")).toBeVisible();
  } finally {
    for (const { operation, key } of written) {
      cleanupBrowserIdempotency("sgp", `hub:profile:${operation}`, [key]);
    }
  }
});

test("setup with one step left finishes on it when languages are last (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  const user = await hubUser("sgp");
  await signIn(page, user);
  const profile = {
    display_name: user.displayName,
    handle: user.handle,
    resident_country: "FR",
    biography: "I keep services running.",
    websites: [],
    work_experiences: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        employer_domain: "example.com",
        job_title: "Engineer",
        start_month: "2021-01",
      },
    ],
    educational_qualifications: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        institution_domain: "example.edu",
        degree: "BSc",
      },
    ],
    certifications: [],
    language_abilities: [] as { language_tag: string; ability: string }[],
  };
  await page.route("**/api/hub/profile/read", (route) =>
    route.fulfill({ json: profile }),
  );
  await page.route("**/api/hub/profile/add-language", async (route) => {
    profile.language_abilities = [{ language_tag: "en", ability: "speaking" }];
    await route.fulfill({ status: 204 });
  });
  await page.reload();
  await idealJobField(page).fill("Platform engineer");
  await saveAndContinue(page);

  await expect(heading(page, "Which languages do you use?")).toBeFocused();
  await searchAndChooseOption(
    page,
    page.getByRole("combobox", { name: "Speaking" }),
    "English",
  );
  await page.keyboard.press("Escape");
  // The last item does not take the step away while more may be added.
  await expect(page.getByText("5 of 5 done")).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(heading(page, `Hello, ${user.displayName}`)).toBeFocused();
});

test("Skip stores nothing, wraps, and keeps what was typed (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  await signIn(page, await hubUser("sgp"));
  const writes: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/hub\/(set-|dismiss-|profile\/(?!read))/.test(request.url())) {
      writes.push(request.url());
    }
  });
  await idealJobField(page).fill("Half typed");
  for (const next of [
    "Where have you worked?",
    "Where did you study?",
    "Which languages do you use?",
    "Introduce yourself",
    "What's your ideal job?",
  ]) {
    await skip(page).click();
    await expect(heading(page, next)).toBeFocused();
  }
  await expect(idealJobField(page)).toHaveValue("Half typed");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await step(page, "Education").click();
  await expect(heading(page, "Where did you study?")).toBeFocused();
  await step(page, "Languages").focus();
  await page.keyboard.press("Enter");
  await expect(heading(page, "Which languages do you use?")).toBeFocused();
  expect(writes).toEqual([]);
});

test("leaving setup with unsaved changes asks first (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  await signIn(page, await hubUser("sgp"));
  await idealJobField(page).fill("Half typed");
  const openings = page.getByRole("menuitem", { name: "Openings" });
  await openings.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Leave without saving?");
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(idealJobField(page)).toHaveValue("Half typed");
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);

  await openings.click();
  await dialog.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/openings`);
});

test("signing out with unsaved setup changes signs out (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  const user = await hubUser("sgp");
  await signIn(page, user);
  await idealJobField(page).fill("Half typed");
  await page.getByRole("button", { name: /^Account menu for / }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(heading(page, "Sign in")).toBeVisible();
});

test("a session that ends during setup returns to sign-in (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  await signIn(page, await hubUser("sgp"));
  await page.route("**/api/hub/set-ideal-job", (route) =>
    route.fulfill({
      status: AuthenticationRequiredError.status,
      contentType: "application/problem+json",
      json: AuthenticationRequiredError,
    }),
  );
  await idealJobField(page).fill("Half typed");
  await saveAndContinue(page);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(heading(page, "Sign in")).toBeVisible();
});

test("a narrow screen picks the setup step from a list (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, await hubUser("sgp"));
  await page.getByRole("combobox", { name: "Setup step" }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByTitle("4. Languages", { exact: true })
    .click();
  await expect(heading(page, "Which languages do you use?")).toBeVisible();
});

test("Hide setup ends it on every device (PROF-JOB-006)", async ({
  browser,
  page,
  hubUser,
}) => {
  const user = await hubUser("sgp");
  await signIn(page, user);
  await page.getByRole("button", { name: "Hide setup" }).click();
  await expect(heading(page, `Hello, ${user.displayName}`)).toBeFocused();
  await expect(
    page.getByText(
      "Setup hidden. Finish any time in My profile and Preferences.",
    ),
  ).toBeVisible();
  await expect(idealJobField(page)).toHaveCount(0);
  await page.reload();
  await expect(heading(page, `Hello, ${user.displayName}`)).toBeVisible();

  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await signIn(other, user);
    await expect(heading(other, `Hello, ${user.displayName}`)).toBeVisible();
    await expect(idealJobField(other)).toHaveCount(0);
  } finally {
    await context.close();
  }

  await page.getByRole("link", { name: "Add your ideal job" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/settings/preferences`);
  await expect(idealJobField(page)).toHaveValue("");
});

test("Hide setup asks before losing unsaved changes (PROF-JOB-006)", async ({
  page,
  hubUser,
}) => {
  const user = await hubUser("sgp");
  await signIn(page, user);
  await idealJobField(page).fill("Half typed");
  const hide = page.getByRole("button", { name: "Hide setup" });
  await hide.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(idealJobField(page)).toHaveValue("Half typed");
  await hide.click();
  await dialog.getByRole("button", { name: "Hide setup" }).click();
  await expect(heading(page, `Hello, ${user.displayName}`)).toBeVisible();
});

test("Preferences edits the ideal job and the looking-for-a-job switch (PROF-JOB-007)", async ({
  page,
  hubUser,
}) => {
  await signIn(page, await hubUser("sgp"));
  await openPreferences(page);
  const idealJob = idealJobField(page);
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
  await expect(heading(page, "Where have you worked?")).toBeVisible();
});

test("setup and the job search helper texts render in German (PROF-JOB-008)", async ({
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
  const idealJobHelp =
    "Nicht in Ihrem Profil. Wird bei Bewerbungen mit Unternehmen geteilt.";
  await expect(heading(page, `Willkommen, ${user.displayName}`)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Überspringen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Einrichtung ausblenden" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "Ich suche gerade einen Job (nur Sie sehen das)",
    }),
  ).toBeVisible();
  const help = page.getByRole("button", { name: "Info zu Mein idealer Job" });
  await help.click();
  await expect(page.getByRole("tooltip")).toHaveText(idealJobHelp);

  await page.goto(`${HUB_PORTAL}/settings/preferences`);
  await expect(
    page.getByRole("heading", { name: "Präferenzen", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Ich suche gerade einen Job" }),
  ).toBeVisible();
  await expect(page.getByText("Nur Sie sehen das.")).toBeVisible();
  await help.click();
  await expect(page.getByRole("tooltip")).toHaveText(idealJobHelp);
});
