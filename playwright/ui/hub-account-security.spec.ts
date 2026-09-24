import { randomUUID } from "node:crypto";
import type { Page, Request } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type {
  ConfirmEmailChangeRequest,
  EmailChangeChallenge,
  RequestEmailChangeRequest,
} from "typespec/hub/auth/email_change";
import type { MyInfoResponse } from "typespec/hub/users/profile";
import { RateLimitExceededError } from "typespec/problem/common";
import { RecentAuthenticationRequiredError } from "typespec/problem/hub/authentication";
import {
  EmailAddressUnavailableError,
  EmailChangeCodeRejectedError,
} from "typespec/problem/hub/email";

const hubBaseURL =
  process.env.PLAYWRIGHT_HUB_BASE_URL ?? "http://hub-ui.sgp.localhost";
const handle = "accou-00000000001";
const currentAddress = "person@example.com";

interface Account {
  me: MyInfoResponse;
}

async function openAccountSecurity(page: Page): Promise<Account> {
  const account: Account = {
    me: {
      handle,
      email_address: currentAddress,
      display_name: "Account Owner",
      preferred_language: "en-US",
      resident_country: "SG",
      preferred_job_countries: [],
      totp_enabled: false,
      recovery_codes_remaining: 0,
      session_authenticated_at: new Date().toISOString(),
    },
  };
  await page.addInitScript((userHandle) => {
    sessionStorage.setItem(
      "vetchium.hub.session",
      JSON.stringify({
        session_token: "s".repeat(64),
        session_expires_at: new Date(Date.now() + 600_000).toISOString(),
        preferred_language: "en-US",
        resident_country: "SG",
        handle: userHandle,
        remembered: false,
      }),
    );
  }, handle);
  await page.route("**/api/hub/my-info", (route) =>
    route.fulfill({ json: account.me }),
  );
  await page.route("**/api/hub/my-subscription", (route) =>
    route.fulfill({
      json: { plan_oid: "hub-free-tier", cancel_at_period_end: false },
    }),
  );
  await page.goto(`${hubBaseURL}/settings/security`);
  await expect(
    page.getByRole("heading", { name: "Account & security", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("current-email-address")).toHaveText(
    currentAddress,
  );
  return account;
}

function challenge(): EmailChangeChallenge {
  return {
    challenge_id: randomUUID(),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  };
}

async function acceptEmailChangeRequests(page: Page, issued = challenge()) {
  const requests: Request[] = [];
  await page.route("**/api/hub/request-email-change", async (route) => {
    requests.push(route.request());
    await route.fulfill({ status: 202, json: issued });
  });
  return { issued, requests };
}

async function startChange(page: Page, address: string) {
  await page.getByRole("button", { name: "Change email address" }).click();
  await page.getByLabel("New email address").fill(address);
  await page.getByRole("button", { name: "Send verification code" }).click();
}

function problem(details: { type: string; title: string; status: number }) {
  return {
    status: details.status,
    contentType: "application/problem+json",
    body: JSON.stringify(details),
  };
}

test("the account page shows the sign-in address beside the password and second factor", async ({
  page,
}) => {
  await openAccountSecurity(page);
  await expect(
    page.getByText("It is never shown on your profile.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change password" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set up authenticator" }),
  ).toBeVisible();
});

test("an email change sends a code to the new address and confirms it", async ({
  page,
}) => {
  const account = await openAccountSecurity(page);
  const { issued, requests } = await acceptEmailChangeRequests(page);
  const confirmations: Request[] = [];
  await page.route("**/api/hub/confirm-email-change", async (route) => {
    confirmations.push(route.request());
    account.me = { ...account.me, email_address: "new@example.org" };
    await route.fulfill({ status: 204 });
  });

  await startChange(page, " New@Example.org ");
  await expect(
    page.getByText("If new@example.org can be used", { exact: false }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(
    requests[0]?.postDataJSON() satisfies RequestEmailChangeRequest,
  ).toEqual({ new_email_address: "new@example.org" });
  expect(requests[0]?.headers()["idempotency-key"]).toBeTruthy();

  await page.getByLabel("Six-digit code").fill("123456");
  await page.getByRole("button", { name: "Confirm new address" }).click();
  await expect(
    page.getByText(
      "Your email address was changed. Other browsers were signed out.",
    ),
  ).toBeVisible();
  expect(confirmations).toHaveLength(1);
  expect(
    confirmations[0]?.postDataJSON() satisfies ConfirmEmailChangeRequest,
  ).toEqual({ challenge_id: issued.challenge_id, code: "123456" });
  expect(confirmations[0]?.headers()["idempotency-key"]).toBeTruthy();
  await expect(page.getByTestId("current-email-address")).toHaveText(
    "new@example.org",
  );
  await expect(page.getByLabel("Six-digit code")).toHaveCount(0);
});

test("an email change is checked locally before any request", async ({
  page,
}) => {
  await openAccountSecurity(page);
  const { requests } = await acceptEmailChangeRequests(page);

  await startChange(page, "not-an-address");
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await page.getByLabel("New email address").fill(" PERSON@example.com ");
  await page.getByRole("button", { name: "Send verification code" }).click();
  await expect(
    page.getByText("Enter an address different from your current one."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("button", { name: "Change email address" }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
});

test("a rejected code keeps the change pending and a different code gets a new key", async ({
  page,
}) => {
  await openAccountSecurity(page);
  await acceptEmailChangeRequests(page);
  const keys: string[] = [];
  await page.route("**/api/hub/confirm-email-change", async (route) => {
    const { code } = route
      .request()
      .postDataJSON() as ConfirmEmailChangeRequest;
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (code === "111111") {
      await route.fulfill(problem(EmailChangeCodeRejectedError));
      return;
    }
    await route.fulfill({ status: 204 });
  });

  await startChange(page, "new@example.org");
  const code = page.getByLabel("Six-digit code");
  await code.fill("111111");
  const confirm = page.getByRole("button", { name: "Confirm new address" });
  await confirm.click();
  await expect(
    page.getByText(
      "That code could not be accepted. Check it or send a new code.",
    ),
  ).toBeVisible();
  await confirm.click();
  await expect.poll(() => keys.length).toBe(2);
  await code.fill("222222");
  await confirm.click();
  await expect(
    page.getByText("Your email address was changed.", { exact: false }),
  ).toBeVisible();
  expect(keys).toHaveLength(3);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

test("sending a new code issues a fresh request for the same address", async ({
  page,
}) => {
  await openAccountSecurity(page);
  const { requests } = await acceptEmailChangeRequests(page);
  await startChange(page, "new@example.org");
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  await page.getByRole("button", { name: "Send a new code" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]?.postDataJSON()).toEqual({
    new_email_address: "new@example.org",
  });
  expect(requests[1]?.headers()["idempotency-key"]).not.toBe(
    requests[0]?.headers()["idempotency-key"],
  );
});

test("a pending change survives a reload and cancel forgets it", async ({
  page,
}) => {
  await openAccountSecurity(page);
  await acceptEmailChangeRequests(page);
  await startChange(page, "new@example.org");
  await expect(page.getByLabel("Six-digit code")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  await expect(
    page.getByText("If new@example.org can be used", { exact: false }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("button", { name: "Change email address" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Change email address" }),
  ).toBeVisible();
  await expect(page.getByLabel("Six-digit code")).toHaveCount(0);
});

test("an email change request explains too many code requests", async ({
  page,
}) => {
  await openAccountSecurity(page);
  await page.route("**/api/hub/request-email-change", (route) =>
    route.fulfill({
      ...problem(RateLimitExceededError),
      headers: { "Retry-After": "60" },
    }),
  );
  await startChange(page, "new@example.org");
  await expect(
    page.getByText("Too many attempts. Please wait and try again."),
  ).toBeVisible();
  await expect(page.getByLabel("New email address")).toBeVisible();
  await expect(page.getByLabel("Six-digit code")).toHaveCount(0);
});

test("a personal address outside the signup allowlist can be requested", async ({
  page,
}) => {
  await openAccountSecurity(page);
  let sent: unknown;
  await page.route("**/api/hub/request-email-change", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      json: {
        challenge_id: randomUUID(),
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      },
    });
  });
  await startChange(page, "someone@gmail.com");
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  expect(sent).toEqual({ new_email_address: "someone@gmail.com" });
});

test("an email change request asks for the password again after the recent-authentication window", async ({
  page,
}) => {
  await openAccountSecurity(page);
  await page.route("**/api/hub/request-email-change", (route) =>
    route.fulfill({
      ...problem(RecentAuthenticationRequiredError),
      headers: { "WWW-Authenticate": 'Bearer realm="hub"' },
    }),
  );
  await startChange(page, "new@example.org");
  await expect(page.getByText("Confirm your identity")).toBeVisible();
  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page).toHaveURL(
    /\/reauthenticate\?returnTo=%2Fsettings%2Fsecurity/,
  );
});

test("confirming an address another account took meanwhile is explained", async ({
  page,
}) => {
  await openAccountSecurity(page);
  await acceptEmailChangeRequests(page);
  await page.route("**/api/hub/confirm-email-change", (route) =>
    route.fulfill(problem(EmailAddressUnavailableError)),
  );
  await startChange(page, "new@example.org");
  await page.getByLabel("Six-digit code").fill("123456");
  await page.getByRole("button", { name: "Confirm new address" }).click();
  await expect(
    page.getByText("Another Vetchium account already uses that address."),
  ).toBeVisible();
  await expect(page.getByTestId("current-email-address")).toHaveText(
    currentAddress,
  );
});

test("the preferences page changes the display language", async ({ page }) => {
  const account = await openAccountSecurity(page);
  let sent: unknown;
  await page.route("**/api/hub/set-preferred-language", async (route) => {
    sent = route.request().postDataJSON();
    account.me = { ...account.me, preferred_language: "de-DE" };
    await route.fulfill({ status: 204 });
  });
  await page.getByRole("menuitem", { name: "Preferences" }).click();
  await expect(page).toHaveURL(`${hubBaseURL}/settings/preferences`);
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByText("Deutsch (Deutschland)", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Präferenzen", level: 1 }),
  ).toBeVisible();
  expect(sent).toEqual({ preferred_language: "de-DE" });
});
