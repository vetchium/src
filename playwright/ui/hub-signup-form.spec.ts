import type { Page, Request, Route } from "@playwright/test";
import type { RequestSignupRequest } from "typespec/hub/auth/signup";
import { RateLimitExceededError } from "typespec/problem/common";
import {
  SignupDomainNotAllowedError,
  SignupUnavailableError,
} from "typespec/problem/hub/signup";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseOption,
  expect,
  recordRegionalAPIHosts,
  searchAndChooseOption,
  test,
} from "../lib/region-ui.ts";

const accepted = (route: Route) => route.fulfill({ status: 202 });

function refused(problem: { status: number }) {
  return (route: Route) =>
    route.fulfill({
      status: problem.status,
      contentType: "application/problem+json",
      json: problem,
    });
}

/** Answers request-signup with each of `answers` in turn, then accepts. */
async function stubSignup(
  page: Page,
  ...answers: ((route: Route) => Promise<void>)[]
): Promise<Request[]> {
  const requests: Request[] = [];
  await page.route("**/api/hub/request-signup", async (route) => {
    const answer = answers[requests.length] ?? accepted;
    requests.push(route.request());
    await answer(route);
  });
  return requests;
}

const body = (request: Request | undefined) =>
  request?.postDataJSON() as RequestSignupRequest;
const key = (request: Request | undefined) =>
  request?.headers()["idempotency-key"];

const name = (page: Page) => page.getByRole("textbox", { name: "Your name" });
const email = (page: Page) =>
  page.getByRole("textbox", { name: "Email", exact: true });
const country = (page: Page) =>
  page.getByRole("combobox", { name: "Country you live in" });
const send = (page: Page) =>
  page.getByRole("button", { name: "Email me a link" }).click();

async function fillForm(page: Page, address = "person@example.com") {
  await page.goto(`${HUB_PORTAL}/signup`);
  await name(page).fill(" Example Person ");
  await email(page).fill(address);
  await searchAndChooseOption(page, country(page), "Singapore");
}

test("signup explains every missing or invalid field and sends nothing", async ({
  page,
}) => {
  const hosts = recordRegionalAPIHosts(page);
  await page.goto(`${HUB_PORTAL}/signup`);
  await send(page);
  await expect(
    page.getByText("Enter your name, up to 200 characters."),
  ).toBeVisible();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Choose the country you live in.")).toBeVisible();
  await expect(name(page)).toBeFocused();

  await name(page).fill("x".repeat(201));
  await email(page).fill("not-an-address");
  await send(page);
  await expect(
    page.getByText("Enter your name, up to 200 characters."),
  ).toBeVisible();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  expect(hosts).toEqual([]);
});

test("each signup field explains itself to the keyboard and the pointer", async ({
  page,
}) => {
  await page.goto(`${HUB_PORTAL}/signup`);
  await name(page).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "About Email", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveText(
    "For sign-in and notifications. Never shown on your profile.",
  );
  await page.keyboard.press("Tab");
  await expect(email(page)).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  await page
    .getByRole("button", { name: "About Country you live in", exact: true })
    .click();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Shown on your profile. You can still apply to jobs worldwide.",
  );
  await page.keyboard.press("Escape");
  await searchAndChooseOption(page, country(page), "Singapore");
  await page
    .getByRole("button", { name: "About Account region", exact: true })
    .click();
  await expect(
    page.getByText(
      "Where your account is stored. You pick it when you sign in, and can't change it later.",
    ),
  ).toBeVisible();
});

test("the header's language when sent is the email's language, with no second language field", async ({
  page,
}) => {
  const requests = await stubSignup(page);
  await fillForm(page);
  // The country is the form's only choice.
  await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Select language" }).click();
  await page.getByRole("option", { name: "Deutsch (Deutschland)" }).click();
  await expect(
    page.getByRole("textbox", { name: "Ihr Name", exact: true }),
  ).toHaveValue(" Example Person ");
  await page.getByRole("button", { name: "Link per E-Mail senden" }).click();
  await expect(
    page.getByRole("heading", { name: "E-Mails prüfen" }),
  ).toBeVisible();
  expect(body(requests[0])).toEqual({
    display_name: "Example Person",
    email_address: "person@example.com",
    preferred_language: "de-DE",
    resident_country: "SG",
  });
});

test("a sent link can be sent again or to another address", async ({
  page,
}) => {
  const requests = await stubSignup(
    page,
    accepted,
    refused(RateLimitExceededError),
  );
  await fillForm(page, "typo@example.com");
  await send(page);
  await expect(
    page.getByText(
      "If typo@example.com can be used, a link to finish signup is on its way.",
    ),
  ).toBeVisible();
  await expect(email(page)).toHaveCount(0);

  const again = page.getByRole("button", { name: "Send again" });
  await again.click();
  await expect(page.getByRole("alert")).toContainText(
    "Too many attempts. Please wait and try again.",
  );
  await again.click();
  await expect(
    page.getByText("Sent again. Only the newest link works."),
  ).toBeVisible();
  expect(requests).toHaveLength(3);
  expect(body(requests[2])).toEqual(body(requests[0]));
  // A new send has a new key; retrying a failed one keeps its key.
  expect(key(requests[1])).not.toBe(key(requests[0]));
  expect(key(requests[2])).toBe(key(requests[1]));

  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(email(page)).toBeFocused();
  await expect(email(page)).toHaveValue("typo@example.com");
  await expect(name(page)).toHaveValue(" Example Person ");
  await expect(page.getByTestId("signup-region")).toHaveText("Singapore");
  await email(page).fill("right@example.com");
  await send(page);
  await expect(page.getByText("right@example.com")).toBeVisible();
  expect(body(requests[3]).email_address).toBe("right@example.com");
  expect(key(requests[3])).not.toBe(key(requests[2]));
});

test("a refused email domain is the email field's error", async ({ page }) => {
  const requests = await stubSignup(page, refused(SignupDomainNotAllowedError));
  await fillForm(page, "person@unlisted.example");
  await send(page);
  const error = page.getByText(
    "Signup isn't open to this email domain. Try another address.",
  );
  await expect(error).toHaveCount(1);
  await expect(error).toBeVisible();
  await expect(email(page)).toBeFocused();
  await email(page).fill("person@example.com");
  await expect(error).toHaveCount(0);
  await send(page);
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  expect(key(requests[1])).not.toBe(key(requests[0]));
});

test("a region that refuses signup opens the region choice", async ({
  page,
}) => {
  const requests = await stubSignup(page, refused(SignupUnavailableError));
  await fillForm(page);
  await send(page);
  await expect(page.getByRole("alert")).toContainText(
    "This region is not accepting signup for your country. Choose another region.",
  );
  await chooseOption(
    page,
    page.getByRole("combobox", { name: "Account region" }),
    "India",
  );
  await send(page);
  await expect(
    page.getByText("Account region: India", { exact: true }),
  ).toBeVisible();
  expect(new URL(requests[1]?.url() ?? "").host).toBe(
    "ind1.api.vetchium.localhost",
  );
  expect(key(requests[1])).not.toBe(key(requests[0]));
});

test("a server failure keeps what was typed", async ({ page }) => {
  await stubSignup(page, (route) => route.fulfill({ status: 500 }));
  await fillForm(page);
  await send(page);
  await expect(page.getByRole("alert")).toContainText(
    "Something went wrong. Please try again.",
  );
  await expect(name(page)).toHaveValue(" Example Person ");
  await expect(email(page)).toHaveValue("person@example.com");
});

test("a tap opens a field's explanation", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto(`${HUB_PORTAL}/signup`);
    await page.getByRole("button", { name: "About Email", exact: true }).tap();
    await expect(page.getByRole("tooltip")).toHaveText(
      "For sign-in and notifications. Never shown on your profile.",
    );
  } finally {
    await context.close();
  }
});
