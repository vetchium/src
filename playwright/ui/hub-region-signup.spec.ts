import { createHash, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { LoginRequest } from "typespec/hub/auth/login";
import type { CompleteSignupRequest } from "typespec/hub/auth/signup";
import {
  type HubAccountHomedElsewhereDetails,
  HubAccountHomedElsewhereErrorType,
} from "typespec/problem/hub/signup";
import {
  cleanupHubSignupDomain,
  cleanupHubUser,
  seedHubSignupDomain,
} from "../lib/admin-db.ts";
import { MAILPIT_ORIGIN } from "../lib/hub-api.ts";
import { stubSignupDetails } from "../lib/hub-ui-stubs.ts";
import { emailedLinkToken, HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseOption,
  cleanupBrowserIdempotency,
  expect,
  recordRegionalAPIHosts,
  searchAndChooseOption,
  test,
} from "../lib/region-ui.ts";

// antd keeps a closed dropdown in the document, marked hidden.
const visibleDropdown = (page: Page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");

async function chooseResidentCountry(page: Page, country: string) {
  await searchAndChooseOption(
    page,
    page.getByRole("combobox", { name: "Country you live in" }),
    country,
  );
  await expect(visibleDropdown(page)).toHaveCount(0);
}

function regionSummary(page: Page) {
  return page.getByTestId("signup-region");
}

function accountRegion(page: Page) {
  return page.getByRole("combobox", { name: "Account region" });
}

function changeRegion(page: Page) {
  return page.getByRole("button", { name: "Change account region" }).click();
}

async function expectOfferedRegions(page: Page, labels: string[]) {
  await accountRegion(page).click();
  await expect(
    visibleDropdown(page).locator(".ant-select-item-option"),
  ).toHaveText(labels);
  await page.keyboard.press("Escape");
  await expect(visibleDropdown(page)).toHaveCount(0);
}

test("signup fills the region from the resident country and offers only the regions its table admits", async ({
  page,
}) => {
  const hosts = recordRegionalAPIHosts(page);
  await page.goto(`${HUB_PORTAL}/signup`);
  await expect(regionSummary(page)).toHaveCount(0);
  await expect(accountRegion(page)).toHaveCount(0);

  // deu recommends itself for Germany but keeps Hub signup closed in CI.
  await chooseResidentCountry(page, "Germany");
  await expect(regionSummary(page)).toHaveText("India");
  await changeRegion(page);
  await expectOfferedRegions(page, ["India", "Singapore", "United States"]);
  await chooseOption(page, accountRegion(page), "United States");

  // Another country starts again from its own recommendation.
  await chooseResidentCountry(page, "Singapore");
  await expect(accountRegion(page)).toHaveCount(0);
  await expect(regionSummary(page)).toHaveText("Singapore");
  await changeRegion(page);
  await expectOfferedRegions(page, [
    "India",
    "Singapore (recommended)",
    "United States",
  ]);

  // A country without a recommendation gets the table default.
  await chooseResidentCountry(page, "Brazil");
  await expect(regionSummary(page)).toHaveText("Singapore");
  expect(hosts).toEqual([]);
});

for (const path of [
  "DE",
  "DE/en-US",
  "DE/en-US/details?region=usa1",
  "DE/en-US/details?region=nowhere",
]) {
  test(`the retired signup step /signup/${path} opens the one form`, async ({
    page,
  }) => {
    const hosts = recordRegionalAPIHosts(page);
    await page.goto(`${HUB_PORTAL}/signup/${path}`);
    await expect(page).toHaveURL(`${HUB_PORTAL}/signup`);
    await expect(page.getByRole("textbox", { name: "Your name" })).toHaveValue(
      "",
    );
    await expect(regionSummary(page)).toHaveCount(0);
    expect(hosts).toEqual([]);
  });
}

test("a signup is requested from, and completed and signed in at, the chosen region", async ({
  context,
  page,
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const email = `e2e+${randomUUID()}@${domain}`;
  const password = `Str0ng!${randomUUID()}`;
  const signupKeys: string[] = [];
  const completionKeys: string[] = [];
  let token: string | undefined;
  try {
    seedHubSignupDomain(domain, "usa1");
    await page.goto(`${HUB_PORTAL}/signup`);
    const hosts = recordRegionalAPIHosts(page);
    await page
      .getByRole("textbox", { name: "Your name" })
      .fill("Region Signup");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await chooseResidentCountry(page, "Germany");
    await changeRegion(page);
    await chooseOption(page, accountRegion(page), "United States");
    // Nothing typed is sent, or put in the URL, before submit.
    expect(hosts).toEqual([]);
    await expect(page).toHaveURL(`${HUB_PORTAL}/signup`);

    const sent = page.waitForRequest("**/api/hub/request-signup");
    await page.getByRole("button", { name: "Email me a link" }).click();
    const signupRequest = await sent;
    signupKeys.push(signupRequest.headers()["idempotency-key"] ?? "");
    expect(signupRequest.url()).toBe(
      "http://usa1.api.vetchium.localhost/api/hub/request-signup",
    );
    await expect(
      page.getByRole("heading", { name: "Check your email" }),
    ).toBeFocused();
    await expect(
      page.getByText("Account region: United States", { exact: true }),
    ).toBeVisible();
    expect(new Set(hosts)).toEqual(new Set(["usa1.api.vetchium.localhost"]));

    const mailbox = `${MAILPIT_ORIGIN}/view/latest.txt?query=${encodeURIComponent(
      `to:${email}`,
    )}`;
    let text = "";
    await expect
      .poll(
        async () => {
          const mail = await request.get(mailbox);
          text = mail.ok() ? await mail.text() : "";
          return emailedLinkToken(text, "/complete-signup", "usa1");
        },
        { timeout: 15_000 },
      )
      .toMatch(/^[0-9a-f]{64}$/);
    token = emailedLinkToken(text, "/complete-signup", "usa1");
    expect(text).toContain(
      `${HUB_PORTAL}/complete-signup?region=usa1&token=${token}`,
    );

    // The emailed link alone decides the completion and sign-in region,
    // whatever the browser remembered.
    const link = await context.newPage();
    const linkHosts = recordRegionalAPIHosts(link);
    link.on("request", (sentRequest) => {
      if (sentRequest.url().endsWith("/api/hub/complete-signup")) {
        completionKeys.push(sentRequest.headers()["idempotency-key"] ?? "");
      }
    });
    await link.goto(`${HUB_PORTAL}/complete-signup?region=usa1&token=${token}`);
    await expect(
      link.getByText(
        "Account region: United States. You'll be signed in right away.",
      ),
    ).toBeVisible();
    await expect(
      link.getByText(`Creating account for ${email}`, { exact: true }),
    ).toBeVisible();
    await link.getByLabel("Password", { exact: true }).fill(password);
    const login = link.waitForRequest("**/api/hub/login");
    await link.getByRole("button", { name: "Create account" }).click();
    expect((await login).postDataJSON() satisfies LoginRequest).toEqual({
      email_address: email,
      password,
      remember_me: false,
    });
    await expect(
      link.getByRole("heading", { name: "Welcome, Region Signup" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(link).toHaveURL(`${HUB_PORTAL}/`);
    expect(new Set(linkHosts)).toEqual(
      new Set(["usa1.api.vetchium.localhost"]),
    );

    // Signup's own sign-in does not preselect the next sign-in's region.
    const other = await context.newPage();
    await other.goto(`${HUB_PORTAL}/login`);
    await expect(other.getByRole("button", { name: "Sign in" })).toBeDisabled();
  } finally {
    cleanupBrowserIdempotency("usa1", "hub:request-signup", signupKeys);
    if (token !== undefined) {
      const hash = createHash("sha256").update(token).digest("hex");
      cleanupBrowserIdempotency(
        "usa1",
        `hub:complete-signup:${hash}`,
        completionKeys,
      );
    }
    cleanupHubUser(email, "usa1");
    cleanupHubSignupDomain(domain, "usa1");
  }
});

for (const home of [
  { tenantID: "deu", country: "DE", login: "/login?region=deu" },
  { tenantID: "nowhere", country: "DE", login: "/login" },
]) {
  test(`a completion homed at ${home.tenantID} links to ${home.login}`, async ({
    page,
  }) => {
    const token = "b".repeat(64);
    const password = `Str0ng!${randomUUID()}`;
    await stubSignupDetails(page);
    await page.route("**/api/hub/complete-signup", async (route) => {
      expect(new URL(route.request().url()).host).toBe(
        "sgp.api.vetchium.localhost",
      );
      expect(
        route.request().postDataJSON() satisfies CompleteSignupRequest,
      ).toEqual({ signup_token: token, password });
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        json: {
          type: HubAccountHomedElsewhereErrorType,
          title: "Hub account homed in another region",
          status: 409,
          detail: "This Hub account signs in at another region",
          tenant_id: home.tenantID,
          hosting_country: home.country,
        } satisfies HubAccountHomedElsewhereDetails,
      });
    });

    await page.goto(`${HUB_PORTAL}/complete-signup?region=sgp&token=${token}`);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    const notice = page.getByTestId("complete-signup-homed-elsewhere");
    await expect(
      notice.getByText("You already have a Vetchium account in Germany"),
    ).toBeVisible();
    const signIn = notice.getByRole("link", { name: "Go to sign in" });
    await expect(signIn).toHaveAttribute("href", home.login);
    await signIn.click();
    await expect(page).toHaveURL(`${HUB_PORTAL}${home.login}`);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });
}
