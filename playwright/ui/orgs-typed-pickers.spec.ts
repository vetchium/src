import type { Locator, Page } from "@playwright/test";
import type { EmailAddress } from "typespec/common/common";
import type {
  ContactSummary,
  ListContactsResponse,
} from "typespec/orgs/marketplace/contacts/contacts";
import type { EngagementCounterparty } from "typespec/orgs/marketplace/engagements";
import { expect, test } from "../lib/admin-fixtures.ts";
import { addOrgMember } from "../lib/orgs-api.ts";
import { withAgency } from "../lib/orgs-chat-requests.ts";
import { openEditorStep, signIn, withOrg } from "../lib/orgs-ui.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";

test.describe.configure({ timeout: 120_000 });

/**
 * Answers a suggestion operation from `items`, in their order, to a request
 * without a query. One with a query is answered only when `answersQueries`;
 * otherwise it stays unanswered, as while typing has not settled.
 */
async function suggest<Item>(
  page: Page,
  operation: string,
  member: string,
  items: readonly Item[],
  text: (item: Item) => string,
  answersQueries: boolean,
) {
  await page.route(`**/api/orgs/${operation}`, async (route) => {
    const { query } = route.request().postDataJSON() as { query?: string };
    if (query !== undefined && !answersQueries) return;
    await route.fulfill({
      json: {
        [member]: items.filter((item) =>
          text(item).includes(query?.toLowerCase() ?? ""),
        ),
      },
    });
  });
}

function shownOptions(page: Page): Locator {
  return page.locator(
    ".ant-select-dropdown:visible .ant-select-item-option-content",
  );
}

for (const answered of [false, true]) {
  const when = answered ? "after" : "before";
  test(`Enter adds the team member typed in full ${when} the search answers`, async ({
    page,
    request,
  }) => {
    await withOrg(request, async (org) => {
      const first = `abo@${org.domain}`;
      const typed = `bo@${org.domain}`;
      const other = `cy@${org.domain}`;
      await suggest<EmailAddress>(
        page,
        "suggest-org-users",
        "users",
        [first, typed, other],
        (email) => email,
        answered,
      );
      await signIn(page, org);
      await page.goto(`${ORGS_PORTAL}/openings/new`);
      await openEditorStep(page, "Hiring team and notes");
      const members = page.getByRole("combobox", { name: "Team members" });
      await members.click();
      const options = shownOptions(page);
      await expect(options).toHaveCount(3);

      await members.fill(typed);
      if (answered) await expect(options).toHaveCount(2);
      await members.press("Enter");
      const chosen = page.locator(".ant-select-multiple").filter({
        has: members,
      });
      await expect(chosen.getByTitle(typed, { exact: true })).toBeVisible();
      await expect(chosen.getByTitle(first, { exact: true })).toHaveCount(0);

      // Typing a member again neither removes them nor adds someone else.
      await members.fill(typed);
      await members.press("Enter");
      await expect(members).toHaveValue("");
      await expect(chosen.getByTitle(typed, { exact: true })).toBeVisible();
      await expect(chosen.getByTitle(first, { exact: true })).toHaveCount(0);
    });
  });
}

test("Enter keeps the hiring manager typed in full when the answer reorders the list", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    const first = `abo@${org.domain}`;
    const typed = `bo@${org.domain}`;
    await page.route("**/api/orgs/suggest-org-users", async (route) => {
      const { query } = route.request().postDataJSON() as { query?: string };
      // As the API orders them: by address, then prefix matches first.
      const users = query === undefined ? [first, typed] : [typed, first];
      await route.fulfill({ json: { users } });
    });
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/openings/new`);
    await openEditorStep(page, "Hiring team and notes");
    const manager = page.getByRole("combobox", { name: "Hiring manager" });
    await manager.click();
    const options = shownOptions(page);
    await expect(options).toHaveText([first, typed]);

    const answered = page.waitForResponse("**/api/orgs/suggest-org-users");
    await manager.fill(typed);
    await answered;
    await expect(options).toHaveText([typed, first]);
    await manager.press("Enter");
    await expect(manager).toHaveValue(typed);
  });
});

for (const answered of [false, true]) {
  const when = answered ? "after" : "before";
  test(`Enter picks the client and Job owner typed in full ${when} the search answers`, async ({
    page,
    request,
  }) => {
    await withAgency(request, async ({ pair: { provider } }) => {
      const domain = provider.org.domain;
      const colleague = await addOrgMember(
        provider.api,
        provider.owner,
        domain,
        `bo@${domain}`,
        ["org:fulfil_engagements"],
      );
      await suggest<EmailAddress>(
        page,
        "suggest-job-owners",
        "owners",
        [`abo@${domain}`, colleague.emailAddress],
        (email) => email,
        answered,
      );
      await suggest<EngagementCounterparty>(
        page,
        "suggest-clients",
        "clients",
        [
          { display_name: "Alpha", domain: "big-acme.test" },
          { display_name: "Beta", domain: "acme.test" },
          { display_name: "Gamma", domain: "gamma.test" },
        ],
        (client) => client.domain,
        answered,
      );
      await signIn(page, provider.org, provider.tenant);
      await page.goto(`${ORGS_PORTAL}/sourcing/jobs?owner=all`);
      const options = shownOptions(page);

      const owner = page.getByRole("combobox", { name: "Owned by…" });
      await owner.click();
      await expect(options).toHaveCount(2);
      const searched = answered
        ? page.waitForRequest(
            (sent) =>
              sent.url().endsWith("/suggest-job-owners") &&
              sent.postDataJSON().query !== undefined,
          )
        : undefined;
      await owner.fill(colleague.emailAddress);
      if (searched) await (await searched).response();
      await owner.press("Enter");
      await expect
        .poll(() => new URL(page.url()).searchParams.get("owner"))
        .toBe(colleague.emailAddress);

      const client = page.getByRole("combobox", { name: "Search clients" });
      await client.click();
      await expect(options).toHaveCount(3);
      await client.fill("acme.test");
      if (answered) await expect(options).toHaveCount(2);
      await client.press("Enter");
      await expect
        .poll(() => new URL(page.url()).searchParams.get("client"))
        .toBe("acme.test");

      // The client already chosen never stands in for the next one typed.
      await client.click();
      await client.fill("gamma.test");
      if (answered)
        await expect(options.filter({ hasText: "Alpha" })).toHaveCount(0);
      await client.press("Enter");
      await expect
        .poll(() => new URL(page.url()).searchParams.get("client"))
        .toBe("gamma.test");
    });
  });
}

test("Enter picks the Job typed in full before the search answers", async ({
  page,
  request,
}) => {
  await withAgency(request, async ({ pair: { provider }, person }) => {
    const { handle } = person();
    await page.route("**/api/orgs/list-jobs", async (route) => {
      const { search } = route.request().postDataJSON() as { search?: string };
      if (search === undefined) await route.continue();
    });
    await signIn(page, provider.org, provider.tenant);
    await page.goto(`${ORGS_PORTAL}/sourcing/contacts/${handle}`);
    await page.getByRole("button", { name: "Send chat request" }).click();
    const dialog = page.getByRole("dialog", { name: "Send chat request" });
    const job = dialog.getByRole("combobox", { name: "Opening" });
    await job.click();
    const options = shownOptions(page);
    await expect(options).toHaveCount(2);
    // The second, which is not the option active before typing.
    const label = (await options.last().textContent()) ?? "";
    await job.fill(label.slice(0, label.indexOf(" (")));
    await job.press("Enter");
    await expect(dialog.getByTitle(label, { exact: true })).toBeVisible();
  });
});

for (const deleted of [false, true]) {
  const picks = deleted ? "nobody for a deleted" : "the";
  test(`Enter picks ${picks} Contact typed in full over a name containing it`, async ({
    page,
    request,
  }) => {
    await withAgency(request, async (agency) => {
      const contact = (
        display_name: string,
        handle: string,
      ): ContactSummary => ({
        display_name,
        handle,
        status: "in_conversation",
        requests_off: false,
        account_deleted: false,
        note_count: 0,
        has_conversation: true,
        unread_messages_count: 0,
        credited_count: 0,
        last_activity_at: "2026-01-01T00:00:00Z",
      });
      await page.route("**/api/orgs/list-contacts", async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as ListContactsResponse;
        const items = [
          contact("JoAnne Roe", "joanne-roe"),
          { ...contact("Anne Roe", "anne-roe"), account_deleted: deleted },
        ];
        await route.fulfill({ response, json: { ...body, items } });
      });
      const { provider } = agency.pair;
      await signIn(page, provider.org, provider.tenant);
      const [{ opening_number }] = agency.openings;
      await page.goto(
        `${ORGS_PORTAL}/sourcing/jobs/${agency.engagementID}/${opening_number}`,
      );
      await page.getByRole("button", { name: "Suggest to a contact" }).click();
      const dialog = page.getByRole("dialog", { name: "Suggest to a contact" });
      const picker = dialog.getByRole("combobox", { name: "Contact" });
      await picker.click();
      await expect(shownOptions(page)).toHaveCount(2);
      await picker.fill("Anne Roe");
      await picker.press("Enter");
      await expect(picker).toHaveAttribute("aria-expanded", "false");
      await expect(dialog.getByText("Anne Roe", { exact: true })).toHaveCount(
        deleted ? 0 : 1,
      );
      await expect(dialog.getByText("JoAnne Roe", { exact: true })).toHaveCount(
        0,
      );
    });
  });
}
