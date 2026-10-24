import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { orgsIdempotencyKey } from "../lib/orgs-api.ts";
import {
  activate,
  asProvider,
  setDisplayName,
} from "../lib/orgs-marketplace.ts";
import { assign, withWorld } from "../lib/orgs-routing.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  type HubTestUser,
  test,
} from "../lib/region-ui.ts";

test.describe.configure({ timeout: 180_000 });

async function signIn(page: Page, user: HubTestUser) {
  await page.goto(`${HUB_PORTAL}/login?region=${user.tenant}`);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, user.tenant);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
}

test("messages: unread badge, view suggestion, reply, and delete conversation", async ({
  page,
  request,
  hubUser,
}) => {
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;

    setDisplayName(consumer.org, consumer.tenant, "Consumer Corp");
    setDisplayName(provider.org, provider.tenant, "Agency Alpha");

    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);

    const user = await hubUser("sgp", { displayName: "Ada Candidate" });

    // Agency sends opening suggestion to start conversation
    const startRes = await provider.api.startConversation(
      provider.owner,
      {
        address: user.handle,
        suggestion: {
          consumer_domain: consumer.org.domain,
          opening_number: opening.opening_number,
        },
      },
      orgsIdempotencyKey(),
    );
    expect(startRes.status(), await startRes.text()).toBe(200);

    // Sign in as candidate to Hub UI
    await signIn(page, user);

    // 1. Navigation has Messages link with unread badge
    const messagesNav = page.getByRole("menuitem", { name: /Messages/ });
    await expect(messagesNav).toBeVisible();
    await messagesNav.click();

    await expect(
      page.getByRole("heading", { name: "Messages", exact: true }),
    ).toBeVisible();

    // Conversation is in list
    const conversationItem = page.getByText("Agency Alpha").first();
    await expect(conversationItem).toBeVisible();

    // 2. Select conversation: Opening suggestion card is visible
    await conversationItem.click();
    await expect(
      page.getByText(`${provider.org.domain} · Agency`),
    ).toBeVisible();
    await expect(page.getByText("Opening suggestion")).toBeVisible();
    await expect(page.getByText("Consumer Corp")).toBeVisible();

    // 3. Send a reply
    const replyText = `Thanks for sharing! ${randomUUID()}`;
    await page.getByPlaceholder("Write a reply").fill(replyText);
    await page.getByRole("button", { name: /Send/ }).click();

    // Reply appears in bubble
    await expect(page.getByText(replyText)).toBeVisible();
    await expect(page.getByText(/You ·/)).toBeVisible();

    // 4. Delete conversation
    await page
      .getByRole("button", { name: "Delete", exact: false })
      .first()
      .click();
    await expect(page.getByText("Delete conversation?")).toBeVisible();
    await page.getByRole("button", { name: "Delete conversation" }).click();

    // Conversation is removed from list
    await expect(
      page.getByText(
        "No messages yet. When recruitment agencies reach out about Openings, your conversations appear here.",
      ),
    ).toBeVisible();
  });
});

test("apply from suggestion preselects agency referral and submits application", async ({
  page,
  request,
  hubUser,
}) => {
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;

    setDisplayName(consumer.org, consumer.tenant, "Consumer Corp");
    setDisplayName(provider.org, provider.tenant, "Agency Alpha");

    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);

    const user = await hubUser("sgp", { displayName: "Ada Candidate" });

    // Agency sends opening suggestion
    const startRes = await provider.api.startConversation(
      provider.owner,
      {
        address: user.handle,
        suggestion: {
          consumer_domain: consumer.org.domain,
          opening_number: opening.opening_number,
        },
      },
      orgsIdempotencyKey(),
    );
    expect(startRes.status(), await startRes.text()).toBe(200);

    await signIn(page, user);

    // Open messages
    await page.goto(`${HUB_PORTAL}/messages`);
    await page.getByText("Agency Alpha").first().click();

    // Click "View and apply" from the suggestion card
    const viewAndApplyBtn = page.getByRole("button", {
      name: "View and apply",
    });
    await expect(viewAndApplyBtn).toBeVisible();
    await viewAndApplyBtn.click();

    // Navigated to apply page with referred_by query param
    await expect(page).toHaveURL(
      new RegExp(
        `/org/${encodeURIComponent(consumer.org.domain)}/openings/${opening.opening_number}/apply\\?referred_by=${encodeURIComponent(provider.org.domain)}`,
      ),
    );

    // Referred by card has provider agency selected
    await expect(page.getByText("Referred by")).toBeVisible();
    const agencyRadio = page.getByRole("radio", {
      name: /Agency Alpha/,
    });
    await expect(agencyRadio).toBeChecked();

    // Submit application
    await page.getByRole("button", { name: "Submit application" }).click();

    // Redirected to application detail page
    await expect(page).toHaveURL(
      new RegExp(
        `/applications/${encodeURIComponent(consumer.org.domain)}/${opening.opening_number}/\\d+`,
      ),
    );
  });
});

test("declared referral refused for ineligible agency then corrected to no agency", async ({
  page,
  request,
  hubUser,
}) => {
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer } = pair;

    const user = await hubUser("sgp", { displayName: "Ada Candidate" });
    await signIn(page, user);

    // Navigate directly to apply page
    await page.goto(
      `${HUB_PORTAL}/org/${consumer.org.domain}/openings/${opening.opening_number}/apply`,
    );
    await expect(
      page.getByRole("heading", { name: "Apply", exact: true }),
    ).toBeVisible();

    // "No agency" is selected by default
    const noAgencyRadio = page.getByRole("radio", { name: "No agency" });
    await expect(noAgencyRadio).toBeChecked();

    // Choose "Another agency"
    await page.getByRole("radio", { name: "Another agency" }).click();

    // Enter ineligible agency domain
    const badDomain = "ineligible-agency.example";
    await page.getByPlaceholder("agency.example").fill(badDomain);

    // Submit application
    await page.getByRole("button", { name: "Submit application" }).click();

    // Inline error appears under the domain input
    await expect(
      page.getByText(
        `${badDomain} isn't an agency working on this Opening. Check the domain, or choose another agency or none.`,
      ),
    ).toBeVisible();

    // Correct choice: select "No agency"
    await noAgencyRadio.click();

    // Submit application again
    await page.getByRole("button", { name: "Submit application" }).click();

    // Succeeds and navigates to application detail
    await expect(page).toHaveURL(
      new RegExp(
        `/applications/${encodeURIComponent(consumer.org.domain)}/${opening.opening_number}/\\d+`,
      ),
    );
  });
});

test("preferences agency messages switch toggles read-only state and professional emails notice", async ({
  page,
  request,
  hubUser,
}) => {
  await withWorld(request, async (world) => {
    const { pair } = world;
    const { provider } = pair;

    setDisplayName(provider.org, provider.tenant, "Agency Alpha");

    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);

    const user = await hubUser("sgp", { displayName: "Ada Candidate" });

    // Agency sends a message
    const startRes = await provider.api.startConversation(
      provider.owner,
      {
        address: user.handle,
        text: "Hello! We would like to discuss an opportunity.",
      },
      orgsIdempotencyKey(),
    );
    expect(startRes.status(), await startRes.text()).toBe(200);

    await signIn(page, user);

    // 1. Check Professional emails page shows "What agencies see" notice
    await page.goto(`${HUB_PORTAL}/settings/work-emails`);
    await expect(
      page.getByRole("heading", { name: "Professional emails", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("What agencies see")).toBeVisible();
    await expect(
      page.getByText(
        "Agencies that view your profile see each verified domain with the month and year you first and last verified it — for example grab.com, Mar 2023 – Oct 2026. They never see the addresses.",
      ),
    ).toBeVisible();

    // 2. Go to Preferences page
    await page.goto(`${HUB_PORTAL}/settings/preferences`);
    await expect(
      page.getByRole("heading", { name: "Preferences", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Agency messages")).toBeVisible();

    // Toggle switch off
    const toggle = page.getByRole("switch", {
      name: "Agencies may message me",
    });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    // 3. Open Messages: conversation is now read-only
    await page.goto(`${HUB_PORTAL}/messages`);
    await page.getByText("Agency Alpha").first().click();

    await expect(
      page.getByText("Conversation is read-only", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This conversation is read-only because agency messages are turned off in your preferences.",
      ),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Write a reply")).toBeHidden();

    // 4. Re-enable in Preferences
    await page.goto(`${HUB_PORTAL}/settings/preferences`);
    await page.getByRole("switch", { name: "Agencies may message me" }).click();
    await expect(
      page.getByRole("switch", { name: "Agencies may message me" }),
    ).toBeChecked();

    // Reply is available again
    await page.goto(`${HUB_PORTAL}/messages`);
    await page.getByText("Agency Alpha").first().click();
    await expect(page.getByPlaceholder("Write a reply")).toBeVisible();
  });
});
