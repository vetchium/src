import { expect, test } from "@playwright/test";
import type { CompleteSignupRequest } from "typespec/hub/auth/signup";
import { HUB_PORTAL } from "../lib/portals.ts";

const password = "Str0ng!Passphrase2026";

/**
 * Drives CompleteSignupPage directly with a mocked API response, mirroring
 * signup-regions.spec.ts's mocked-network style rather than a real signup:
 * the homed-elsewhere response is a coordinator-driven edge case that is far
 * cheaper to exercise this way than through a second real tenant signup.
 */
test("a signup completed elsewhere sends the user to their home region instead of a password form", async ({
  page,
}) => {
  const token = "a".repeat(64);
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

  await page.goto(`${HUB_PORTAL}/complete-signup?region=usa1&token=${token}`);
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Complete signup" }).click();

  const notice = page.getByTestId("complete-signup-homed-elsewhere");
  await expect(notice).toBeVisible();
  await expect(
    notice.getByText("You already have a Vetchium account in Singapore"),
  ).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveCount(0);
  await expect(
    notice.getByRole("link", { name: "Go to sign in" }),
  ).toHaveAttribute("href", "/login?region=sgp");
});
