import type { Page } from "@playwright/test";
import { OrgAITermsVersion } from "typespec/orgs/ai/ai";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";
import { chooseRegion } from "../lib/region-ui.ts";

test.describe.configure({ timeout: 90_000 });

async function signIn(
  page: Page,
  user: Pick<SignedUpOrg, "domain" | "emailAddress" | "password">,
) {
  await page.goto(`${ORGS_PORTAL}/login?domain=${user.domain}`);
  await page.getByLabel("Email address").fill(user.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, "sgp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("shell-org-name")).toBeVisible();
}

async function withOrg(
  request: ConstructorParameters<typeof OrgsAPI>[0],
  body: (org: SignedUpOrg, api: OrgsAPI, owner: string) => Promise<void>,
) {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await body(org, api, await loginOrg(api, org));
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

async function goldWithAI(api: OrgsAPI, owner: string): Promise<void> {
  expect(
    (
      await api.setSubscriptionPlan(owner, {
        plan_oid: "org-gold-tier",
        billing_interval: "month",
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.setAISettings(owner, {
        enabled: true,
        accept_terms_version: OrgAITermsVersion,
        policies: [],
      })
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () =>
        (
          (await (await api.aiCredits(owner)).json()) as {
            balance: { available: number };
          }
        ).balance.available,
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
}

test("drafting with AI fills the new Opening form without saving it", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    await goldWithAI(api, owner);
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/new`);
    await page.getByTestId("draft-with-ai").click();
    const prompt = page.getByRole("textbox", {
      name: "What should the AI write?",
    });
    await expect(prompt).toBeVisible();
    await expect(page.getByTestId("ai-draft-estimate")).toContainText(
      "credits available",
    );
    const generate = page.getByRole("button", { name: "Generate draft" });
    await expect(generate).toBeDisabled();

    // An unusable answer is reported in place and charges nothing.
    await prompt.fill("Engineer [ai-dev:invalid]");
    await generate.click();
    await expect(
      page.getByText("The AI's answer could not be used."),
    ).toBeVisible();

    await prompt.fill("Platform engineer");
    await generate.click();
    await expect(page.getByText("Draft filled in.")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue(
      "Draft: Platform engineer",
    );
    await expect(page.getByLabel("Location details")).toHaveValue(
      "Drafted by ai/qwen3:1.7b",
    );
    // The Org's country set by the editor stays; nothing was saved.
    const listed = await api.post("/list-openings", {}, { token: owner });
    expect((await listed.json()).openings).toEqual([]);

    // Another allowed model may be chosen.
    await page.getByTestId("draft-with-ai").click();
    await page.getByRole("combobox", { name: "Model" }).click();
    await page.getByTitle("Ministral 3 3B (Mistral AI)").click();
    await page
      .getByRole("textbox", { name: "What should the AI write?" })
      .fill("Data analyst");
    await page.getByRole("button", { name: "Generate draft" }).click();
    await expect(page.getByLabel("Location details")).toHaveValue(
      "Drafted by ai/ministral3:3B-Q4_K_M",
    );
  });
});

test("the drafting prompt explains why AI cannot run", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/new`);
    await page.getByTestId("draft-with-ai").click();
    await expect(
      page.getByText("AI assistance is off for your organization."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Generate draft" }),
    ).toBeDisabled();
    const prompt = page.getByRole("textbox", {
      name: "What should the AI write?",
    });
    await page
      .getByRole("tooltip")
      .filter({ has: prompt })
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(prompt).toBeHidden();
  });
});

test("an AI manager turns AI on, buys credits, and reviews usage", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    await signIn(page, org);
    await page.getByRole("menuitem", { name: "AI", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "AI", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("need the Gold plan")).toBeVisible();

    await page.getByRole("switch", { name: "AI assistance" }).click();
    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await page.getByRole("checkbox", { name: /I accept the AI terms/ }).check();
    await save.click();
    await expect(page.getByText("AI settings saved.")).toBeVisible();
    await expect(page.getByText(/AI terms version .* accepted/)).toBeVisible();

    await page.getByRole("tab", { name: "Credits" }).click();
    await expect(
      page.getByText("Buying credits needs the Gold plan."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Buy" }).first(),
    ).toBeDisabled();

    expect(
      (
        await api.setSubscriptionPlan(owner, {
          plan_oid: "org-gold-tier",
          billing_interval: "month",
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await page.getByRole("tab", { name: "Credits" }).click();
    await page.getByRole("button", { name: "Buy" }).first().click();
    await expect(page.getByText("you will not be charged")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Buy" }).click();
    await expect(page.getByText("Credits added.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Purchase" })).toBeVisible();

    const drafted = await api.draftOpeningWithAI(owner, {
      instruction: "Support lead",
    });
    expect(drafted.status(), await drafted.text()).toBe(200);
    await page.getByRole("tab", { name: "Usage" }).click();
    await expect(page.getByRole("cell", { name: "Completed" })).toBeVisible();
    await page
      .getByRole("button", { name: /^View the prompt and answer/ })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Request:\nSupport lead")).toBeVisible();
    await expect(dialog.getByText(/Draft: Support lead/)).toBeVisible();
  });
});

test("people without org:manage_ai see no AI page", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const recruiter = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain, "recruiter"),
      ["org:manage_openings"],
    );
    await signIn(page, recruiter);
    await expect(
      page.getByRole("menuitem", { name: "AI", exact: true }),
    ).toHaveCount(0);
    await page.goto(`${ORGS_PORTAL}/ai`);
    await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
  });
});
