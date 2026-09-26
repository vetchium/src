import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { AliasState } from "typespec/hub/profile/alias";
import type { ProfessionalEmail } from "typespec/hub/profile/professional_email";
import type { PublicProfile } from "typespec/hub/profile/public";
import type { HubSubscription } from "typespec/hub/subscriptions/subscriptions";

const hubBaseURL =
  process.env.PLAYWRIGHT_HUB_BASE_URL ?? "http://hub-ui.sgp.localhost";

/** Drives the month picker through its year panel rather than typing, since
 * the masked text input does not reliably commit a value on `fill`/`Enter`.
 * Scoped to the currently visible dropdown: an already-selected month field
 * can leave its own closed panel in the DOM alongside the next field's. */
async function pickMonth(
  page: Page,
  field: Locator,
  year: number,
  monthAbbreviation: string,
) {
  await field.click();
  const panel = page.locator(".ant-picker-dropdown:visible").last();
  await panel.getByRole("button", { name: "Choose a year" }).click();
  const yearCell = panel.getByText(String(year), { exact: true });
  if (!(await yearCell.isVisible())) {
    await panel.getByRole("button", { name: "Last decade" }).click();
  }
  await yearCell.click();
  await panel.getByText(monthAbbreviation, { exact: true }).click();
}

const freeSubscription: HubSubscription = {
  plan_oid: "hub-free-tier",
  cancel_at_period_end: false,
};

const silverSubscription: HubSubscription = {
  plan_oid: "hub-silver-tier",
  billing_interval: "month",
  current_period_start: "2026-09-01T00:00:00Z",
  current_period_end: "2099-09-01T00:00:00Z",
  cancel_at_period_end: false,
};

async function openEditor(
  page: Page,
  emails: ProfessionalEmail[] = [],
  overrides: Partial<PublicProfile> = {},
  entitlement: {
    subscription?: HubSubscription;
    aliasState?: AliasState;
  } = {},
  destination: "profile" | "work-emails" = "profile",
) {
  const handle = `edito-${randomUUID().replaceAll("-", "").slice(0, 11)}`;
  const profile: PublicProfile = {
    display_name: "Original Name",
    handle,
    resident_country: "SG",
    biography: "Original biography",
    websites: [],
    work_experiences: [],
    educational_qualifications: [],
    certifications: [],
    language_abilities: [],
    ...overrides,
  };
  await page.addInitScript(
    ({ userHandle }) => {
      sessionStorage.setItem(
        "vetchium.hub.session",
        JSON.stringify({
          session_token: "s".repeat(64),
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
          preferred_language: "en-US",
          resident_country: "SG",
          handle: userHandle,
          remembered: false,
        }),
      );
    },
    { userHandle: handle },
  );
  await page.route("**/api/hub/my-info", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        handle,
        email_address: `editor+${handle}@example.test`,
        display_name: profile.display_name,
        preferred_language: "en-US",
        resident_country: "SG",
        preferred_job_countries: [],
        totp_enabled: false,
        recovery_codes_remaining: 0,
        session_authenticated_at: new Date().toISOString(),
      }),
    }),
  );
  await page.route("**/api/hub/profile/read", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(profile),
    }),
  );
  await page.route("**/api/hub/profile/professional-email/list", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ emails }),
    }),
  );
  await page.route("**/api/hub/my-subscription", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(entitlement.subscription ?? freeSubscription),
    }),
  );
  await page.route("**/api/hub/profile/alias/state", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(entitlement.aliasState ?? { profile_alias: null }),
    }),
  );
  if (destination === "work-emails") {
    await page.goto(`${hubBaseURL}/settings/work-emails`);
    await expect(
      page.getByRole("heading", { name: "Professional emails", level: 1 }),
    ).toBeVisible();
    return profile;
  }
  await page.goto(`${hubBaseURL}/settings/profile`);
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
  await expect(page.getByLabel("Biography")).toHaveValue("Original biography");
  return profile;
}

test("the owner edits public introduction and sees refreshed profile data", async ({
  page,
}) => {
  const profile = await openEditor(page);
  let writes = 0;
  await page.route("**/api/hub/profile/set-public-fields", async (route) => {
    writes += 1;
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({
      display_name: "Updated Name",
      biography: "Updated biography",
    });
    profile.display_name = "Updated Name";
    profile.biography = "Updated biography";
    await route.fulfill({
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  });
  await page.getByLabel("Display name", { exact: true }).fill(" Updated Name ");
  await page.getByLabel("Biography").fill(" Updated biography ");
  await page.getByRole("button", { name: "Save introduction" }).click();
  await expect(
    page.getByText("Your public introduction was saved."),
  ).toBeVisible();
  await expect(page.getByLabel("Biography")).toHaveValue("Updated biography");
  await page.getByLabel("Biography").fill("Unwanted change");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByLabel("Biography")).toHaveValue("Updated biography");
  expect(writes).toBe(1);
});

test("adding a professional email immediately and explicitly requests its verification code", async ({
  page,
}) => {
  const emails: ProfessionalEmail[] = [];
  await openEditor(page, emails, {}, {}, "work-emails");
  const address = `person+${randomUUID()}@example.org`;
  const id = randomUUID();
  const challengeID = randomUUID();
  let sent = 0;
  await page.route(
    "**/api/hub/profile/professional-email/add",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        email_address: address,
      });
      emails.push({
        id,
        email_address: address,
        domain: "example.org",
        created_at: new Date().toISOString(),
      });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(emails[0]),
      });
    },
  );
  await page.route(
    "**/api/hub/profile/professional-email/request-code",
    async (route) => {
      sent += 1;
      expect(route.request().postDataJSON()).toEqual({ id });
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          challenge_id: challengeID,
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        }),
      });
    },
  );
  await page.getByRole("button", { name: "Add email" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Professional email address").fill(` ${address} `);
  await dialog.getByRole("button", { name: "Add and send code" }).click();
  await expect(page.getByText(address)).toBeVisible();
  await expect(page.getByLabel("Six-digit verification code")).toBeVisible();
  expect(sent).toBe(1);
  await page.reload();
  await expect(page.getByLabel("Six-digit verification code")).toBeVisible();
  await page.route(
    "**/api/hub/profile/professional-email/verify",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        id,
        challenge_id: challengeID,
        code: "123456",
      });
      const verified = emails[0];
      if (verified === undefined) throw new Error("test email was not added");
      verified.first_verified_at = new Date().toISOString();
      verified.last_verified_at = verified.first_verified_at;
      await route.fulfill({ status: 204 });
    },
  );
  await page.getByLabel("Six-digit verification code").fill("123456");
  await page.getByRole("button", { name: "Verify address" }).click();
  await expect(page.getByText("Address verified.")).toBeVisible();
  await expect(page.getByText(/First verified/)).toBeVisible();
  expect(sent).toBe(1);
});

test("annual reminder stays in the owner UI and deletion requires confirmation", async ({
  page,
}) => {
  const address = `person+${randomUUID()}@example.org`;
  const id = randomUUID();
  const emails: ProfessionalEmail[] = [
    {
      id,
      email_address: address,
      domain: "example.org",
      first_verified_at: "2020-01-01T00:00:00Z",
      last_verified_at: "2021-01-01T00:00:00Z",
      created_at: "2020-01-01T00:00:00Z",
    },
  ];
  await openEditor(page, emails, {}, {}, "work-emails");
  await expect(page.getByText(/It has been a year/)).toBeVisible();
  let deletions = 0;
  await page.route(
    "**/api/hub/profile/professional-email/delete",
    async (route) => {
      deletions += 1;
      expect(route.request().postDataJSON()).toEqual({ id });
      emails.splice(0, 1);
      await route.fulfill({ status: 204 });
    },
  );
  await page.getByRole("button", { name: "Remove address" }).first().click();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(deletions).toBe(0);
  await expect(page.getByText(address)).toBeVisible();
  await page.getByRole("button", { name: "Remove address" }).first().click();
  await page.getByRole("button", { name: "Remove address" }).last().click();
  await expect(page.getByText(address)).toHaveCount(0);
  expect(deletions).toBe(1);
});

test("the profile page holds only what other users see", async ({ page }) => {
  const profile = await openEditor(page);
  await expect(
    page.getByText(
      "This is what other Hub users and recruiters see when they open your profile.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(`editor+${profile.handle}@example.test`),
  ).toHaveCount(0);
  await expect(page.getByText("Profile ID")).toHaveCount(0);
  await expect(
    page.getByText(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/),
  ).toHaveCount(0);
  await expect(page.getByText("Your addresses")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Preferred job countries" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Language", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Where you live", { exact: true })).toBeVisible();
  await expect(page.getByText("Singapore", { exact: true })).toBeVisible();
});

test("changing the resident country saves it and refreshes the profile", async ({
  page,
}) => {
  const profile = await openEditor(page);
  let sent: unknown;
  await page.route("**/api/hub/set-resident-country", async (route) => {
    sent = route.request().postDataJSON();
    profile.resident_country = "FR";
    await route.fulfill({ status: 204 });
  });
  const reads = page.waitForRequest("**/api/hub/profile/read");
  const country = page.getByLabel("Resident country");
  await country.fill("France");
  await country.press("Enter");
  await expect(
    page.getByText("Your resident country was saved."),
  ).toBeVisible();
  expect(sent).toEqual({ resident_country: "FR" });
  await reads;
});

test("invalid public fields stay local and discard restores saved values", async ({
  page,
}) => {
  await openEditor(page);
  let writes = 0;
  await page.route("**/api/hub/profile/set-public-fields", (route) => {
    writes += 1;
    return route.fulfill({ status: 204 });
  });
  await page.getByLabel("Display name", { exact: true }).fill(" ");
  await page.getByRole("button", { name: "Save introduction" }).click();
  await expect(
    page.getByText("Enter a display name of up to 200 characters."),
  ).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(
    "Original Name",
  );
});

test("a failed public-field save keeps the draft and displays an error", async ({
  page,
}) => {
  await openEditor(page);
  await page.route("**/api/hub/profile/set-public-fields", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Internal server error",
        status: 500,
      }),
    }),
  );
  await page.getByLabel("Biography").fill("Unsaved draft");
  await page.getByRole("button", { name: "Save introduction" }).click();
  await expect(page.getByLabel("Biography")).toHaveValue("Unsaved draft");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("a new work experience normalizes its employer domain before saving", async ({
  page,
}) => {
  await openEditor(page);
  let writes = 0;
  await page.route("**/api/hub/profile/save-work-experience", async (route) => {
    writes += 1;
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({
      employer_domain: "example.com",
      job_title: "Engineer",
      start_month: "2020-01",
      end_month: null,
      location: null,
      description: null,
    });
    await route.fulfill({ status: 204 });
  });
  await page.getByRole("button", { name: "Add work experience" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Employer domain").fill("Example.COM.");
  await dialog.getByLabel("Job title").fill("Engineer");
  const startMonth = dialog.getByRole("textbox", { name: "Start month" });
  await pickMonth(page, startMonth, 2020, "Jan");
  await dialog.getByRole("button", { name: "Add work experience" }).click();
  await expect(page.getByText("Work experience added.")).toBeVisible();
  expect(writes).toBe(1);
});

test("an end month before the start month is rejected locally without any network write", async ({
  page,
}) => {
  await openEditor(page);
  let writes = 0;
  await page.route("**/api/hub/profile/save-work-experience", (route) => {
    writes += 1;
    return route.fulfill({ status: 204 });
  });
  await page.getByRole("button", { name: "Add work experience" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Employer domain").fill("example.com");
  await dialog.getByLabel("Job title").fill("Engineer");
  const startMonth = dialog.getByRole("textbox", { name: "Start month" });
  await pickMonth(page, startMonth, 2020, "Jan");
  const endMonth = dialog.getByRole("textbox", { name: "End month" });
  await pickMonth(page, endMonth, 2019, "Jan");
  await dialog.getByRole("button", { name: "Add work experience" }).click();
  await expect(
    page.getByText("Choose an end month on or after the start month."),
  ).toBeVisible();
  expect(writes).toBe(0);
});

test("deleting a work experience requires confirmation", async ({ page }) => {
  const workExperienceID = randomUUID();
  const profile = await openEditor(page, [], {
    work_experiences: [
      {
        id: workExperienceID,
        employer_domain: "example.com",
        job_title: "Engineer",
        start_month: "2020-01",
      },
    ],
  });
  let deletions = 0;
  await page.route(
    "**/api/hub/profile/delete-work-experience",
    async (route) => {
      deletions += 1;
      expect(route.request().postDataJSON()).toEqual({ id: workExperienceID });
      profile.work_experiences = [];
      await route.fulfill({ status: 204 });
    },
  );
  await expect(page.getByText("Engineer")).toBeVisible();
  // The entry's own icon trigger is labeled with its title ("Delete
  // Engineer"); the Popconfirm's own confirm button stays generic ("Delete").
  await page.getByRole("button", { name: "Delete Engineer" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(deletions).toBe(0);
  await expect(page.getByText("Engineer")).toBeVisible();
  await page.getByRole("button", { name: "Delete Engineer" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Engineer")).toHaveCount(0);
  expect(deletions).toBe(1);
});

test("a language can be added then removed within one ability", async ({
  page,
}) => {
  const profile = await openEditor(page);
  await page.route("**/api/hub/profile/add-language", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      ability: "speaking",
      language_tag: "fr",
    });
    profile.language_abilities.push({
      ability: "speaking",
      language_tag: "fr",
    });
    await route.fulfill({ status: 204 });
  });
  const speaking = page.getByRole("combobox", { name: "Speaking" });
  await speaking.fill("French");
  await speaking.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByText("French", { exact: true })).toBeVisible();
  await expect(page.getByText("1/25")).toBeVisible();

  await page.route("**/api/hub/profile/delete-language", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      ability: "speaking",
      language_tag: "fr",
    });
    profile.language_abilities = [];
    await route.fulfill({ status: 204 });
  });
  // Re-selecting an already-chosen option in a multi-select combobox
  // deselects it, the same accessible interaction used to add it.
  await speaking.fill("French");
  await speaking.press("Enter");
  await page.keyboard.press("Escape");
  // Reading and Writing also read "0/25" since the mock profile starts with
  // no languages in any ability, so the count must be scoped to Speaking's
  // own heading row rather than matched by text alone.
  const speakingCount = page
    .locator(".ant-flex-justify-space-between")
    .filter({
      has: page.getByRole("heading", { name: "Speaking", exact: true }),
    })
    .getByText("0/25");
  await expect(speakingCount).toBeVisible();
});
test("a free-tier owner is told an alias and a picture need a paid plan", async ({
  page,
}) => {
  await openEditor(page);
  await expect(
    page.getByText("A paid plan is needed to claim a profile alias."),
  ).toBeVisible();
  await expect(
    page.getByText("A paid plan is needed to add a profile picture."),
  ).toBeVisible();
  await expect(page.getByLabel("Profile alias")).toHaveCount(0);
});

test("an entitled owner claims an alias through a durable operation", async ({
  page,
}) => {
  await openEditor(page, [], {}, { subscription: silverSubscription });
  const operationID = randomUUID();
  let claims = 0;
  let polls = 0;
  await page.route("**/api/hub/profile/alias/set", async (route) => {
    claims += 1;
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({
      profile_alias: "ada-lovelace",
    });
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ operation_id: operationID }),
    });
  });
  await page.route("**/api/hub/operations/status", async (route) => {
    polls += 1;
    expect(route.request().postDataJSON()).toEqual({
      operation_id: operationID,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        operation_id: operationID,
        // The first poll is still in flight, so the UI must keep waiting.
        state: polls === 1 ? "pending" : "succeeded",
      }),
    });
  });
  await page.getByLabel("Profile alias").fill("ada-lovelace");
  await page.getByRole("button", { name: "Save alias" }).click();
  await expect(page.getByText("Claiming your alias.")).toBeVisible();
  await expect.poll(() => polls, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  expect(claims).toBe(1);
});

test("an alias inside the seven-day cooldown cannot be changed", async ({
  page,
}) => {
  let writes = 0;
  await page.route("**/api/hub/profile/alias/set", async (route) => {
    writes += 1;
    await route.fulfill({ status: 500 });
  });
  await openEditor(
    page,
    [],
    {},
    {
      subscription: silverSubscription,
      aliasState: {
        profile_alias: "ada-lovelace",
        next_change_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    },
  );
  await expect(page.getByText(/You can change your alias again/)).toBeVisible();
  await expect(page.getByLabel("Profile alias")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save alias" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Remove alias" }),
  ).toBeDisabled();
  expect(writes).toBe(0);
});

test("an oversized or wrongly typed picture never reaches the API", async ({
  page,
}) => {
  await openEditor(page, [], {}, { subscription: silverSubscription });
  let uploads = 0;
  await page.route("**/api/hub/profile/picture/upload", async (route) => {
    uploads += 1;
    await route.fulfill({ status: 204 });
  });
  const chooser = page.locator('input[type="file"]');
  await chooser.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByText("Choose a JPEG or PNG image.")).toBeVisible();
  await chooser.setInputFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
  });
  await expect(
    page.getByText("Choose an image no larger than 8 MB."),
  ).toBeVisible();
  expect(uploads).toBe(0);
});

test("an accepted picture is uploaded as raw bytes and can be removed", async ({
  page,
}) => {
  const bytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const profile = await openEditor(
    page,
    [],
    {},
    { subscription: silverSubscription },
  );
  await page.route("**/api/hub/profile/picture/upload", async (route) => {
    const request = route.request();
    expect(request.headers()["content-type"]).toBe("image/png");
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.postDataBuffer()).toEqual(bytes);
    profile.profile_picture_url = "https://media.example.test/signed";
    await route.fulfill({ status: 204 });
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await expect(
    page.getByText("Your profile picture was updated."),
  ).toBeVisible();
  let removals = 0;
  await page.route("**/api/hub/profile/picture/remove", async (route) => {
    removals += 1;
    delete profile.profile_picture_url;
    await route.fulfill({ status: 204 });
  });
  await page.getByRole("button", { name: "Remove picture" }).first().click();
  await page.getByRole("button", { name: "Remove picture" }).last().click();
  await expect(
    page.getByText("Your profile picture was removed."),
  ).toBeVisible();
  expect(removals).toBe(1);
});

test("an ending paid entitlement is announced in the portal", async ({
  page,
}) => {
  await openEditor(
    page,
    [],
    {},
    {
      subscription: {
        ...silverSubscription,
        current_period_end: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        cancel_at_period_end: true,
        scheduled_change: { plan_oid: "hub-free-tier" },
      },
    },
  );
  await expect(page.getByText(/Your paid access ends on/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review plans" }),
  ).toBeVisible();
});

const githubID = "00000000-0000-4000-8000-00000000a001";
const blogID = "00000000-0000-4000-8000-00000000a002";

function tenWebsites() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `00000000-0000-4000-8000-00000000e${String(index).padStart(3, "0")}`,
    url: `https://site-${index}.example.test`,
  }));
}

test("the editor groups identity fields, with websites under the introduction, before the background sections", async ({
  page,
}) => {
  await openEditor(page);
  const top = async (locator: Locator) => {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return box?.y ?? 0;
  };
  const inOrder = [
    page.getByRole("heading", { name: "About you" }),
    page.getByLabel("Biography"),
    page.getByText("Websites", { exact: true }),
    page.getByText("Where you live", { exact: true }),
    page.getByText("Profile alias", { exact: true }).first(),
    page.getByRole("heading", { name: "Background" }),
    page.getByText("Work experience", { exact: true }),
  ];
  const positions: number[] = [];
  for (const locator of inOrder) positions.push(await top(locator));
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(new Set(positions).size).toBe(positions.length);
});

test("the owner adds a website, which is normalized before it is saved", async ({
  page,
}) => {
  const profile = await openEditor(page);
  await expect(page.getByText("No websites added yet.")).toBeVisible();
  let writes = 0;
  await page.route("**/api/hub/profile/save-website", async (route) => {
    writes += 1;
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({
      url: "https://github.com/octocat",
    });
    profile.websites = [{ id: githubID, url: "https://github.com/octocat" }];
    await route.fulfill({
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  });
  await page.getByRole("button", { name: "Add website" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Website URL").fill("  HTTPS://GitHub.com/octocat/ ");
  await dialog.getByRole("button", { name: "Add website" }).click();
  await expect(page.getByText("Website added.")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(writes).toBe(1);
  // The saved entry shows its kind and the exact address that is stored.
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/octocat",
  );
  await expect(
    page.getByText("https://github.com/octocat", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No websites added yet.")).toHaveCount(0);
});

test("invalid or duplicate website addresses are rejected locally without any network write", async ({
  page,
}) => {
  await openEditor(page, [], {
    websites: [{ id: githubID, url: "https://github.com/octocat" }],
  });
  let writes = 0;
  await page.route("**/api/hub/profile/save-website", (route) => {
    writes += 1;
    return route.fulfill({ status: 204 });
  });
  await page.getByRole("button", { name: "Add website" }).click();
  const dialog = page.getByRole("dialog");
  const field = dialog.getByLabel("Website URL");
  const invalidMessage =
    "Enter a valid HTTPS address, such as https://example.com, with no username, password, or fragment.";
  for (const value of [
    "",
    "github.com/octocat",
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/page#section",
    "https://localhost",
    "https://127.0.0.1",
    "https://example.com/ü",
  ]) {
    await field.fill(value);
    await dialog.getByRole("button", { name: "Add website" }).click();
    await expect(dialog.getByText(invalidMessage), value).toBeVisible();
  }
  // The same address, however it is spelled, is already listed.
  await field.fill(" HTTPS://GITHUB.com/octocat/ ");
  await dialog.getByRole("button", { name: "Add website" }).click();
  await expect(
    dialog.getByText("You have already added this website."),
  ).toBeVisible();
  expect(writes).toBe(0);
});

test("editing a website sends its id, and saving it unchanged is not a duplicate of itself", async ({
  page,
}) => {
  const profile = await openEditor(page, [], {
    websites: [
      { id: githubID, url: "https://github.com/octocat" },
      { id: blogID, url: "https://octocat.example.dev/blog" },
    ],
  });
  const bodies: unknown[] = [];
  await page.route("**/api/hub/profile/save-website", async (route) => {
    const body = route.request().postDataJSON() as { id: string; url: string };
    bodies.push(body);
    profile.websites = profile.websites.map((site) =>
      site.id === body.id ? { id: body.id, url: body.url } : site,
    );
    await route.fulfill({ status: 204 });
  });
  await page
    .getByRole("button", { name: "Edit https://octocat.example.dev/blog" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Website URL")).toHaveValue(
    "https://octocat.example.dev/blog",
  );
  // The other entry's address is a duplicate, this entry's own is not.
  await dialog.getByLabel("Website URL").fill("https://github.com/octocat");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(
    dialog.getByText("You have already added this website."),
  ).toBeVisible();
  expect(bodies).toEqual([]);
  await dialog
    .getByLabel("Website URL")
    .fill("https://octocat.example.dev/blog");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Website updated.")).toBeVisible();
  expect(bodies).toEqual([
    { id: blogID, url: "https://octocat.example.dev/blog" },
  ]);

  await page
    .getByRole("button", { name: "Edit https://octocat.example.dev/blog" })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Website URL")
    .fill("https://octocat.example.dev/writing");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByText("https://octocat.example.dev/writing", { exact: true }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual({
    id: blogID,
    url: "https://octocat.example.dev/writing",
  });
});

test("cancelling the website dialog writes nothing", async ({ page }) => {
  await openEditor(page);
  let writes = 0;
  await page.route("**/api/hub/profile/save-website", (route) => {
    writes += 1;
    return route.fulfill({ status: 204 });
  });
  await page.getByRole("button", { name: "Add website" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Website URL").fill("https://example.com");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  // A reopened dialog starts empty rather than keeping the abandoned draft.
  await page.getByRole("button", { name: "Add website" }).click();
  await expect(page.getByRole("dialog").getByLabel("Website URL")).toHaveValue(
    "",
  );
  expect(writes).toBe(0);
});

test("deleting a website requires confirmation", async ({ page }) => {
  const profile = await openEditor(page, [], {
    websites: [{ id: githubID, url: "https://github.com/octocat" }],
  });
  let deletions = 0;
  await page.route("**/api/hub/profile/delete-website", async (route) => {
    deletions += 1;
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({ id: githubID });
    profile.websites = [];
    await route.fulfill({ status: 204 });
  });
  const remove = page.getByRole("button", {
    name: "Delete https://github.com/octocat",
  });
  await remove.click();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(deletions).toBe(0);
  await expect(remove).toBeVisible();
  await remove.click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Website removed.")).toBeVisible();
  await expect(page.getByText("No websites added yet.")).toBeVisible();
  expect(deletions).toBe(1);
});

test("the ten-website limit disables adding and is explained", async ({
  page,
}) => {
  const nine = tenWebsites().slice(0, 9);
  const profile = await openEditor(page, [], { websites: nine });
  await expect(page.getByRole("button", { name: "Add website" })).toBeEnabled();
  await expect(
    page.getByText("You have reached the limit of 10 websites."),
  ).toHaveCount(0);

  await page.route("**/api/hub/profile/save-website", async (route) => {
    profile.websites = tenWebsites();
    await route.fulfill({ status: 204 });
  });
  await page.getByRole("button", { name: "Add website" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Website URL").fill("https://site-9.example.test");
  await dialog.getByRole("button", { name: "Add website" }).click();
  await expect(page.getByText("Website added.")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("You have reached the limit of 10 websites."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add website" }),
  ).toBeDisabled();
  // Existing entries stay editable at the limit.
  await expect(
    page.getByRole("button", { name: "Edit https://site-3.example.test" }),
  ).toBeEnabled();
});

test("a failed website save keeps the dialog and the typed address and shows the error", async ({
  page,
}) => {
  await openEditor(page);
  let attempt = 0;
  await page.route("**/api/hub/profile/save-website", (route) => {
    attempt += 1;
    if (attempt === 1) {
      return route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Internal server error",
          status: 500,
        }),
      });
    }
    return route.fulfill({
      status: 409,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "vetchium-problem-details/hub-profile-conflict",
        title: "Hub profile conflict",
        status: 409,
        detail: "The profile change conflicts with the current state",
      }),
    });
  });
  await page.getByRole("button", { name: "Add website" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Website URL").fill("https://example.com/me");
  await dialog.getByRole("button", { name: "Add website" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Website URL")).toHaveValue(
    "https://example.com/me",
  );
  // A conflict, such as the limit being reached from another browser, gets
  // its own localized message.
  await dialog.getByRole("button", { name: "Add website" }).click();
  await expect(
    dialog.getByText("This profile changed elsewhere. Refresh and try again."),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(attempt).toBe(2);
});
