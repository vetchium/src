import { expect, test } from "@playwright/test";
import type { ListSignupRegionsResponse } from "typespec/regions/regions";

const origin = "http://hub-ui.sgp.localhost";
const regions: ListSignupRegionsResponse = {
  catalog_version: "1",
  next_pagination_key: null,
  regions: [
    {
      tenant_id: "ind1",
      hosting_country: "IND",
      hub_url: "http://hub-ui.ind1.localhost",
      recommended: true,
    },
    {
      tenant_id: "sgp",
      hosting_country: "SGP",
      hub_url: origin,
      recommended: false,
    },
  ],
};
test("signup selects a region before collecting personal details and supports going back", async ({
  page,
}) => {
  await page.route("**/api/hub/list-signup-regions", async (route) => {
    await route.fulfill({ json: regions });
  });
  await page.goto(`${origin}/signup/IND/en-US`);
  await expect(
    page.getByRole("textbox", { name: "Email address" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Account region" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Account region" }).click();
  await page
    .getByRole("combobox", { name: "Account region" })
    .press("ArrowDown");
  await page.getByRole("combobox", { name: "Account region" }).press("Enter");
  await page.getByRole("button", { name: "Continue in this region" }).click();
  await expect(page).toHaveURL(`${origin}/signup/IND/en-US/details`);
  await page.getByRole("button", { name: "Email my signup link" }).click();
  await expect(
    page.getByText("Enter a display name of no more than 200 characters."),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Display name" }).fill("New User");
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("person@example.com");
  await page.route("**/api/hub/request-signup", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email_address: "person@example.com",
      display_name: "New User",
      preferred_language: "en-US",
      resident_country: "IND",
    });
    await route.fulfill({
      status: 403,
      contentType: "application/problem+json",
      json: {
        type: "vetchium-problem-details/hub-signup-unavailable",
        title: "Hub signup unavailable",
        status: 403,
      },
    });
  });
  await page.getByRole("button", { name: "Email my signup link" }).click();
  await expect(
    page.getByText(
      "This region is not accepting signup for your country. Choose another region.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Change country or region" }).click();
  await expect(
    page.getByRole("textbox", { name: "Email address" }),
  ).toHaveCount(0);
  await page.getByRole("combobox", { name: "Account region" }).click();
  await page
    .getByRole("combobox", { name: "Account region" })
    .press("ArrowDown");
  await page.getByRole("combobox", { name: "Account region" }).press("Enter");
  await page.getByRole("button", { name: "Continue in this region" }).click();
  await page.route("**/api/hub/request-signup", async (route) => {
    await route.fulfill({ status: 202 });
  });
  await page.getByRole("textbox", { name: "Display name" }).fill("New User");
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("person@example.com");
  await page.getByRole("button", { name: "Email my signup link" }).click();
  await expect(page.getByText(/Check your inbox/)).toBeVisible();
});
test("signup crosses regions with only country and language in the URL", async ({
  page,
}) => {
  await page.route("**/api/hub/list-signup-regions", async (route) => {
    await route.fulfill({ json: regions });
  });
  await page.goto(`${origin}/signup/IND/en-US`);
  await page.getByRole("button", { name: "Continue in this region" }).click();
  await expect(page).toHaveURL(
    "http://hub-ui.ind1.localhost/signup/IND/en-US/details",
  );
  await expect(
    page.getByRole("textbox", { name: "Email address" }),
  ).toBeVisible();
});
test("signup handles discovery errors, retries, and empty eligibility", async ({
  page,
}) => {
  await page.route("**/api/hub/list-signup-regions", async (route) => {
    await route.fulfill({
      status: 500,
      json: { title: "Internal Server Error", status: 500 },
    });
  });
  await page.goto(`${origin}/signup/IND/en-US`);
  await expect(
    page.getByRole("button", { name: "Continue in this region" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Try loading regions again" }),
  ).toBeVisible();
  await page.route("**/api/hub/list-signup-regions", async (route) => {
    await route.fulfill({ json: { ...regions, regions: [] } });
  });
  await page.getByRole("button", { name: "Try loading regions again" }).click();
  await expect(
    page.getByText("No regions are accepting signup for this country."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue in this region" }),
  ).toBeDisabled();
});

test("a signup completion policy refusal offers a new region choice", async ({
  page,
}) => {
  await page.route("**/api/hub/complete-signup", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/problem+json",
      json: {
        type: "vetchium-problem-details/hub-signup-unavailable",
        title: "Hub signup unavailable",
        status: 403,
      },
    });
  });
  await page.goto(`${origin}/complete-signup?token=${"a".repeat(64)}`);
  await page
    .getByLabel("New password", { exact: true })
    .fill("A sufficiently long password!");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("A sufficiently long password!");
  await page
    .getByRole("button", { name: "Complete signup", exact: true })
    .click();
  await expect(
    page.getByText(
      "This region is not accepting signup for your country. Choose another region.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Change country or region" }).click();
  await expect(page).toHaveURL(`${origin}/signup`);
});
