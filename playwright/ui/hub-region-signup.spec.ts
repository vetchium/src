import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
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
import { emailedLinkToken, HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseOption,
  expect,
  recordRegionalAPIHosts,
  test,
} from "../lib/region-ui.ts";

// antd keeps a closed dropdown in the document, marked hidden.
const visibleDropdown = (page: Page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");

async function chooseResidentCountry(page: Page, country: string) {
  await page.getByLabel("Resident country").fill(country);
  await visibleDropdown(page).getByTitle(country, { exact: true }).click();
  await expect(visibleDropdown(page)).toHaveCount(0);
}

function accountRegion(page: Page) {
  return page.getByRole("combobox", { name: "Account region" });
}

async function expectOfferedRegions(page: Page, labels: string[]) {
  await accountRegion(page).click();
  await expect(
    visibleDropdown(page).locator(".ant-select-item-option"),
  ).toHaveText(labels);
  await page.keyboard.press("Escape");
  await expect(visibleDropdown(page)).toHaveCount(0);
}

test("signup offers only the regions whose table admits the resident country", async ({
  page,
}) => {
  await page.goto(`${HUB_PORTAL}/signup`);
  await expect(accountRegion(page)).toHaveCount(0);

  // deu recommends itself for Germany but keeps Hub signup closed in CI.
  await chooseResidentCountry(page, "Germany");
  await expectOfferedRegions(page, [
    "India (ind1)",
    "Singapore (sgp)",
    "United States (usa1)",
  ]);
  await expect(
    page.getByRole("button", { name: "Continue in India (ind1)" }),
  ).toBeVisible();

  await chooseResidentCountry(page, "Singapore");
  await expectOfferedRegions(page, [
    "India (ind1)",
    "Singapore (sgp) — recommended",
    "United States (usa1)",
  ]);
  await expect(
    page.getByRole("button", { name: "Continue in Singapore (sgp)" }),
  ).toBeVisible();
});

for (const region of ["deu", "nowhere", "SGP"]) {
  test(`a details link for the ineligible region ${region} returns to the region choice`, async ({
    page,
  }) => {
    const hosts = recordRegionalAPIHosts(page);
    await page.goto(`${HUB_PORTAL}/signup/DE/en-US/details?region=${region}`);
    await expect(accountRegion(page)).toBeVisible();
    await expect(page.getByLabel("Display name")).toHaveCount(0);
    expect(hosts).toEqual([]);
  });
}

test("a signup is requested from, and completed at, the chosen region", async ({
  context,
  page,
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const email = `e2e+${randomUUID()}@${domain}`;
  const password = `Str0ng!${randomUUID()}`;
  try {
    seedHubSignupDomain(domain, "usa1");
    await page.goto(`${HUB_PORTAL}/signup`);
    await chooseResidentCountry(page, "Germany");
    await chooseOption(page, accountRegion(page), "United States (usa1)");
    await page
      .getByRole("button", { name: "Continue in United States (usa1)" })
      .click();
    await expect(page).toHaveURL(
      `${HUB_PORTAL}/signup/DE/en-US/details?region=usa1`,
    );
    await expect(
      page.getByText("Your account will be hosted in United States (usa1).", {
        exact: true,
      }),
    ).toBeVisible();

    const hosts = recordRegionalAPIHosts(page);
    await page.getByLabel("Display name").fill("Region Signup");
    await page.getByLabel("Email address").fill(email);
    const sent = page.waitForRequest("**/api/hub/request-signup");
    await page.getByRole("button", { name: "Email my signup link" }).click();
    expect((await sent).url()).toBe(
      "http://usa1.api.vetchium.localhost/api/hub/request-signup",
    );
    await expect(
      page.getByText("Check your inbox.", { exact: false }),
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
    const token = emailedLinkToken(text, "/complete-signup", "usa1");
    expect(text).toContain(
      `${HUB_PORTAL}/complete-signup?region=usa1&token=${token}`,
    );

    // The emailed link alone decides the completion region, whatever the
    // browser remembered.
    const link = await context.newPage();
    const linkHosts = recordRegionalAPIHosts(link);
    await link.goto(`${HUB_PORTAL}/complete-signup?region=usa1&token=${token}`);
    await link.getByLabel("New password").fill(password);
    await link.getByLabel("Confirm password").fill(password);
    await link.getByRole("button", { name: "Complete signup" }).click();
    await expect(
      link.getByText("Your account is ready.", { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
    expect(new Set(linkHosts)).toEqual(
      new Set(["usa1.api.vetchium.localhost"]),
    );

    const next = await context.newPage();
    await next.goto(`${HUB_PORTAL}/login`);
    await expect(next.getByRole("button", { name: "Sign in" })).toBeDisabled();
  } finally {
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
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Complete signup" }).click();

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
