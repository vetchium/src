import { expect, type Page, test } from "@playwright/test";
import type { LoginRequest } from "typespec/hub/auth/login";
import type {
  CompleteSignupRequest,
  GetSignupDetailsRequest,
} from "typespec/hub/auth/signup";
import { IdempotencyKeyConflictError } from "typespec/problem/common";
import { InvalidSignupTokenError } from "typespec/problem/hub/signup";
import { stubShellReads, stubSignupDetails } from "../lib/hub-ui-stubs.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import { chooseOption } from "../lib/region-ui.ts";

const password = "Str0ng!Passphrase2026";
const token = "a".repeat(64);
const handle = "examp000-00000000001";
const address = "person@example.com";

const newPasswordError = {
  de: "Verwenden Sie 15 bis 128 Zeichen und vermeiden Sie häufige Passwörter.",
  ta: "15 முதல் 128 எழுத்துகளைப் பயன்படுத்தி பொதுவான கடவுச்சொற்களைத் தவிர்க்கவும்.",
};

const passwordField = (page: Page) =>
  page.getByLabel("Password", { exact: true });

async function submit(page: Page, value = password) {
  await passwordField(page).fill(value);
  await page.getByRole("button", { name: "Create account" }).click();
}

function open(page: Page, region = "usa1") {
  return page.goto(
    `${HUB_PORTAL}/complete-signup?region=${region}&token=${token}`,
  );
}

function session() {
  return {
    authentication_state: "authenticated",
    session_token: "n".repeat(64),
    session_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    preferred_language: "en-US",
    resident_country: "US",
    handle,
  };
}

/** What Home reads for the account signup just created. */
async function stubNewHome(page: Page) {
  await stubShellReads(page);
  await page.route("**/api/hub/my-info", (route) =>
    route.fulfill({
      json: {
        handle,
        email_address: address,
        display_name: "Example Person",
        preferred_language: "en-US",
        resident_country: "US",
        preferred_job_countries: ["US"],
        totp_enabled: false,
        recovery_codes_remaining: 0,
        session_authenticated_at: new Date().toISOString(),
        looking_for_job: false,
        job_search_prompt_dismissed: false,
      },
    }),
  );
  await page.route("**/api/hub/my-subscription", (route) =>
    route.fulfill({
      json: { plan_oid: "hub-free-tier", cancel_at_period_end: false },
    }),
  );
  await page.route("**/api/hub/profile/read", (route) =>
    route.fulfill({
      json: {
        display_name: "Example Person",
        handle,
        resident_country: "US",
        websites: [],
        work_experiences: [],
        educational_qualifications: [],
        certifications: [],
        language_abilities: [],
      },
    }),
  );
}

test.beforeEach(({ page }) => stubSignupDetails(page));

/**
 * Drives CompleteSignupPage directly with a mocked API response, mirroring
 * signup-regions.spec.ts's mocked-network style rather than a real signup:
 * the homed-elsewhere response is a coordinator-driven edge case that is far
 * cheaper to exercise this way than through a second real tenant signup.
 */
test("the password error follows the language without validating again", async ({
  page,
}) => {
  await stubSignupDetails(page);
  await open(page);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText(
      "Use 15 to 128 characters and avoid commonly used passwords.",
    ),
  ).toBeVisible();
  await passwordField(page).fill("too short");
  await page.getByRole("button", { name: "Create account" }).click();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.url());
  });

  await chooseOption(
    page,
    page.getByRole("combobox", { name: "Select language" }),
    "Deutsch (Deutschland)",
  );
  await expect(page.getByText(newPasswordError.de)).toBeVisible();
  const german = page.getByRole("combobox", { name: "Sprache auswählen" });
  await expect(german).toBeFocused();
  await chooseOption(page, german, "தமிழ்");
  await expect(page.getByText(newPasswordError.ta)).toBeVisible();
  await expect(page.getByText(newPasswordError.de)).toHaveCount(0);
  await expect(page.getByLabel("கடவுச்சொல்", { exact: true })).toHaveValue(
    "too short",
  );
  expect(requests).toEqual([]);
});

test("a signup completed elsewhere sends the user to their home region instead of a password form", async ({
  page,
}) => {
  let logins = 0;
  await page.route("**/api/hub/login", async (route) => {
    logins += 1;
    await route.abort();
  });
  await page.route("**/api/hub/complete-signup", async (route) => {
    expect(
      route.request().postDataJSON() satisfies CompleteSignupRequest,
    ).toEqual({ signup_token: token, password });
    await route.fulfill({
      status: 409,
      contentType: "application/problem+json",
      json: {
        type: "vetchium-problem-details/hub-account-homed-elsewhere",
        title: "Hub account homed in another region",
        status: 409,
        detail: "This Hub account signs in at another region",
        tenant_id: "sgp",
        hosting_country: "SG",
      },
    });
  });

  await open(page);
  await submit(page);

  const notice = page.getByTestId("complete-signup-homed-elsewhere");
  await expect(notice).toBeVisible();
  await expect(
    notice.getByText("You already have a Vetchium account in Singapore"),
  ).toBeVisible();
  await expect(passwordField(page)).toHaveCount(0);
  await expect(
    notice.getByRole("link", { name: "Go to sign in" }),
  ).toHaveAttribute("href", "/login?region=sgp");
  expect(logins).toBe(0);
});

test("completion shows the link's address and asks only for a password", async ({
  page,
}) => {
  await page.route("**/api/hub/get-signup-details", async (route) => {
    expect(new URL(route.request().url()).host).toBe(
      "usa1.api.vetchium.localhost",
    );
    expect(
      route.request().postDataJSON() satisfies GetSignupDetailsRequest,
    ).toEqual({ signup_token: token });
    await route.fulfill({ json: { email_address: address } });
  });
  await open(page);
  await expect(
    page.getByText(`Creating account for ${address}`, { exact: true }),
  ).toBeVisible();
  await expect(page.locator("form input:visible")).toHaveCount(1);
  await expect(passwordField(page)).toBeFocused();
  await expect(passwordField(page)).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
  const username = page.locator('form input[autocomplete="username"]');
  await expect(username).toHaveValue(address);
  await expect(username).toBeHidden();
});

test("completion states the password rule and validates before sending", async ({
  page,
}) => {
  let sent = 0;
  await page.route("**/api/hub/complete-signup", async (route) => {
    sent += 1;
    await route.abort();
  });
  await open(page);
  await expect(
    page.getByText("At least 15 characters. A few random words work well."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  const invalid = page.getByText(
    "Use 15 to 128 characters and avoid commonly used passwords.",
  );
  await expect(invalid).toBeVisible();
  for (const weak of ["short password", "passwordpassword"]) {
    await passwordField(page).fill(weak);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(invalid).toBeVisible();
  }
  expect(sent).toBe(0);
});

test("a pending completion retries the same request, then signs in", async ({
  page,
}) => {
  await stubNewHome(page);
  const keys: string[] = [];
  await page.route("**/api/hub/complete-signup", async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    expect(
      route.request().postDataJSON() satisfies CompleteSignupRequest,
    ).toEqual({ signup_token: token, password });
    await (keys.length === 1
      ? route.fulfill({
          status: 202,
          json: { operation_id: "00000000-0000-4000-8000-000000000001" },
        })
      : route.fulfill({ json: { handle } }));
  });
  await page.route("**/api/hub/login", async (route) => {
    expect(new URL(route.request().url()).host).toBe(
      "usa1.api.vetchium.localhost",
    );
    expect(route.request().postDataJSON() satisfies LoginRequest).toEqual({
      email_address: address,
      password,
      remember_me: false,
    });
    await route.fulfill({ json: session() });
  });
  await open(page);
  await submit(page);
  await expect(
    page.getByText(
      "Your account is being finalized. This page will keep checking.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Welcome, Example Person" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test("a failed sign-in after creation retries only the sign-in", async ({
  page,
}) => {
  await stubNewHome(page);
  let completions = 0;
  let logins = 0;
  await page.route("**/api/hub/complete-signup", async (route) => {
    completions += 1;
    await route.fulfill({ json: { handle } });
  });
  await page.route("**/api/hub/login", async (route) => {
    logins += 1;
    expect(route.request().postDataJSON() satisfies LoginRequest).toEqual({
      email_address: address,
      password,
      remember_me: false,
    });
    await (logins === 1
      ? route.fulfill({ status: 500 })
      : route.fulfill({ json: session() }));
  });
  await open(page);
  await submit(page);
  await expect(page.getByText("Your account is ready.")).toBeVisible();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  await expect(passwordField(page)).not.toBeEditable();
  await expect(
    page.getByRole("link", { name: "Continue to sign in" }),
  ).toHaveAttribute("href", "/login");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Example Person" }),
  ).toBeVisible();
  expect(completions).toBe(1);
  expect(logins).toBe(2);
});

test("a reload while finalizing resumes with the same key and password", async ({
  page,
}) => {
  await stubNewHome(page);
  const keys: string[] = [];
  let reloaded = false;
  await page.route("**/api/hub/complete-signup", async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (!reloaded) {
      await route.fulfill({
        status: 202,
        json: { operation_id: "00000000-0000-4000-8000-000000000001" },
      });
      return;
    }
    const sent = route.request().postDataJSON() as CompleteSignupRequest;
    await (sent.password === password
      ? route.fulfill({ json: { handle } })
      : route.fulfill({
          status: IdempotencyKeyConflictError.status,
          contentType: "application/problem+json",
          json: IdempotencyKeyConflictError,
        }));
  });
  await page.route("**/api/hub/login", (route) =>
    route.fulfill({ json: session() }),
  );
  await open(page);
  await submit(page);
  await expect(
    page.getByText(
      "Your account is being finalized. This page will keep checking.",
    ),
  ).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  reloaded = true;
  await submit(page, "An0ther!Passphrase2026");
  await expect(page.getByRole("alert")).toContainText(
    "Account creation already started with another password. Enter that password to continue.",
  );
  await submit(page);
  await expect(
    page.getByRole("heading", { name: "Welcome, Example Person" }),
  ).toBeVisible();
  expect(new Set(keys).size).toBe(1);
});

test("a server failure during completion can be retried with the same key", async ({
  page,
}) => {
  const keys: string[] = [];
  await page.route("**/api/hub/complete-signup", async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    await route.fulfill({ status: 500 });
  });
  await open(page);
  await submit(page);
  await expect(page.getByRole("alert")).toContainText(
    "Something went wrong. Please try again.",
  );
  await page.getByRole("button", { name: "Create account" }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);
});

test("a sign-in that asks for a second factor continues there", async ({
  page,
}) => {
  await page.route("**/api/hub/complete-signup", (route) =>
    route.fulfill({ json: { handle } }),
  );
  await page.route("**/api/hub/login", (route) =>
    route.fulfill({
      json: {
        authentication_state: "totp_required",
        login_challenge_token: "c".repeat(64),
        login_challenge_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    }),
  );
  await open(page);
  await submit(page);
  await expect(page).toHaveURL(`${HUB_PORTAL}/login/two-factor`);
});

test("a spent link offers sign-in and a new signup instead of the form", async ({
  page,
}) => {
  await page.route("**/api/hub/complete-signup", (route) =>
    route.fulfill({
      status: InvalidSignupTokenError.status,
      contentType: "application/problem+json",
      json: InvalidSignupTokenError,
    }),
  );
  await open(page);
  await submit(page);
  await expect(page.getByRole("alert")).toContainText(
    "This link has expired or was already used.",
  );
  await expect(passwordField(page)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toHaveAttribute("href", "/login");
  await page.getByRole("link", { name: "Start signup again" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/signup`);
});

test("an existing session's token never goes to the link's region, and signup's sign-in replaces it", async ({
  page,
}) => {
  await stubNewHome(page);
  const oldToken = "o".repeat(64);
  await page.addInitScript((value) => {
    if (sessionStorage.getItem("vetchium.hub.session") !== null) return;
    sessionStorage.setItem(
      "vetchium.hub.session",
      JSON.stringify({
        tenantId: "sgp",
        session: {
          session_token: value,
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
          preferred_language: "en-US",
          resident_country: "SG",
          handle: "other000-00000000001",
          remembered: false,
        },
      }),
    );
  }, oldToken);
  const authorization: (string | undefined)[] = [];
  await page.route("**/api/hub/get-signup-details", async (route) => {
    authorization.push(route.request().headers().authorization);
    await route.fulfill({ json: { email_address: address } });
  });
  await page.route("**/api/hub/complete-signup", async (route) => {
    authorization.push(route.request().headers().authorization);
    await route.fulfill({ json: { handle } });
  });
  await page.route("**/api/hub/login", async (route) => {
    authorization.push(route.request().headers().authorization);
    await route.fulfill({ json: session() });
  });
  await open(page);
  await submit(page);
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
  expect(authorization).toEqual([undefined, undefined, undefined]);
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("vetchium.hub.session")),
    )
    .toContain("n".repeat(64));
  const stored = await page.evaluate(() =>
    sessionStorage.getItem("vetchium.hub.session"),
  );
  expect(stored).not.toContain(oldToken);
  expect(JSON.parse(stored ?? "{}").tenantId).toBe("usa1");
});

test("a spent link says so on opening", async ({ page }) => {
  await page.route("**/api/hub/get-signup-details", (route) =>
    route.fulfill({
      status: InvalidSignupTokenError.status,
      contentType: "application/problem+json",
      json: InvalidSignupTokenError,
    }),
  );
  await open(page);
  await expect(
    page.getByRole("heading", { name: "This link doesn't work", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "This link has expired or was already used.",
  );
  await expect(passwordField(page)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toHaveAttribute("href", "/login");
  await expect(
    page.getByRole("link", { name: "Start signup again" }),
  ).toHaveAttribute("href", "/signup");
});

test("a failed link lookup can be retried", async ({ page }) => {
  let fail = true;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/hub/get-signup-details", async (route) => {
    await held;
    await (fail
      ? route.fulfill({ status: 500 })
      : route.fulfill({ json: { email_address: address } }));
  });
  await open(page);
  await expect(page.getByLabel("Loading signup link")).toBeVisible();
  release();
  await expect(page.getByRole("alert")).toContainText(
    "Something went wrong. Please try again.",
  );
  await expect(passwordField(page)).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(passwordField(page)).toBeVisible();
});

test("a truncated token is refused without a request", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/hub/")) sent.push(request.url());
  });
  await page.goto(`${HUB_PORTAL}/complete-signup?region=usa1&token=abc`);
  await expect(
    page.getByRole("heading", { name: "This link doesn't work", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "This signup link is incomplete.",
  );
  expect(sent).toEqual([]);
});
