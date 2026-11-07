import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { OpeningSuggestion } from "typespec/orgs/marketplace/contacts/contacts";
import { sqlLiteral, sqlScalarForTenant } from "../lib/admin-db.ts";
import { orgsIdempotencyKey } from "../lib/orgs-api.ts";
import { publishedOpening } from "../lib/orgs-applications.ts";
import {
  agencyRequestState,
  backdateRequest,
  openHubAs,
  pendingAt,
  personAsks,
  sent,
  withAgency,
  withRival,
} from "../lib/orgs-chat-requests.ts";
import {
  activate,
  asProvider,
  awaitHubRequest,
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

test("messages: accept an agency's chat request, reply, and delete the conversation", async ({
  page,
  request,
  hubUser,
}) => {
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;

    await setDisplayName(consumer, "Consumer Corp");
    await setDisplayName(provider, "Agency Alpha");

    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);

    const user = await hubUser("sgp", { displayName: "Ada Candidate" });

    // The agency asks Ada to chat about the Opening.
    const asked = await provider.api.sendChatRequest(
      provider.owner,
      {
        address: user.handle,
        suggestion: {
          consumer_domain: consumer.org.domain,
          opening_number: opening.opening_number,
        },
        note: "Your background fits this role well.",
      },
      orgsIdempotencyKey(),
    );
    expect(asked.status(), await asked.text()).toBe(200);

    // Sign in as candidate to Hub UI
    await signIn(page, user);

    // 1. Navigation has Messages; the request is listed first.
    const messagesNav = page.getByRole("menuitem", { name: /Messages/ });
    await expect(messagesNav).toBeVisible();
    await messagesNav.click();

    await expect(
      page.getByRole("heading", { name: "Messages", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Asks to chat about an Opening")).toBeVisible();
    const conversationItem = page.getByText("Agency Alpha").first();
    await conversationItem.click();

    // 2. The request shows its Opening and note; accepting opens the
    // composer at once, and the request stays as a card.
    await expect(
      page.getByText("Agency Alpha asks to chat with you about this Opening"),
    ).toBeVisible();
    await expect(
      page.getByText("Your background fits this role well."),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Write a reply")).toHaveCount(0);
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(
      page.getByText("You accepted the chat request from Agency Alpha."),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Write a reply")).toBeVisible();
    await expect(
      page.getByText(`${provider.org.domain} · Agency`),
    ).toBeVisible();
    await expect(page.getByText("Chat request", { exact: true })).toBeVisible();
    await expect(page.getByText("Consumer Corp")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "View and apply" }),
    ).toBeVisible();

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

test("apply from an accepted chat request preselects agency referral and submits application", async ({
  page,
  request,
  hubUser,
}) => {
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;

    await setDisplayName(consumer, "Consumer Corp");
    await setDisplayName(provider, "Agency Alpha");

    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);

    const user = await hubUser("sgp", { displayName: "Ada Candidate" });

    // The agency asks Ada about the Opening; she accepts.
    const asked = await provider.api.sendChatRequest(
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
    expect(asked.status(), await asked.text()).toBe(200);

    await signIn(page, user);

    // Open messages
    await page.goto(`${HUB_PORTAL}/messages`);
    await page.getByText("Agency Alpha").first().click();
    await page.getByRole("button", { name: "Accept" }).click();

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

test("Referred by shows only with an assigned agency; an ineligible one is refused then corrected", async ({
  page,
  request,
  hubUser,
}) => {
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer } = pair;

    const user = await hubUser("sgp", { displayName: "Ada Candidate" });
    await signIn(page, user);

    // No agency works on the Opening, so there is nothing to credit.
    const applyURL = `${HUB_PORTAL}/org/${consumer.org.domain}/openings/${opening.opening_number}/apply`;
    await page.goto(applyURL);
    await expect(
      page.getByRole("heading", { name: "Apply", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit application" }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: "No agency" })).toHaveCount(0);
    await expect(page.getByText("Referred by")).toHaveCount(0);

    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);
    await page.goto(applyURL);

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

test("preferences agency chat-requests switch leaves conversations open, and professional emails notice", async ({
  page,
  request,
  hubUser,
}) => {
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;

    await setDisplayName(provider, "Agency Alpha");

    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);

    const user = await hubUser("sgp", { displayName: "Ada Candidate" });

    // The agency asks Ada to chat; she accepts.
    const asked = await provider.api.sendChatRequest(
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
    expect(asked.status(), await asked.text()).toBe(200);

    await signIn(page, user);
    await page.goto(`${HUB_PORTAL}/messages`);
    await page.getByText("Agency Alpha").first().click();
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByPlaceholder("Write a reply")).toBeVisible();

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
    await expect(page.getByText("Agency chat requests")).toBeVisible();
    await expect(
      page.getByText(
        "Turning this off stops new chat requests from agencies. Conversations you have accepted continue, and you can still send chat requests yourself.",
      ),
    ).toBeVisible();

    // Toggle switch off
    const toggle = page.getByRole("switch", {
      name: "Agencies may send me chat requests",
    });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    // 3. Open Messages: the existing conversation stays open for replies.
    await page.goto(`${HUB_PORTAL}/messages`);
    await page.getByText("Agency Alpha").first().click();
    await expect(page.getByPlaceholder("Write a reply")).toBeVisible();
    await expect(
      page.getByText("Conversation is read-only", { exact: true }),
    ).toBeHidden();

    // 4. Re-enable in Preferences
    await page.goto(`${HUB_PORTAL}/settings/preferences`);
    await page
      .getByRole("switch", { name: "Agencies may send me chat requests" })
      .click();
    await expect(
      page.getByRole("switch", { name: "Agencies may send me chat requests" }),
    ).toBeChecked();
  });
});

test("messages: decline an agency's chat requests about one Opening, then for a window", async ({
  page,
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    await setDisplayName(provider, "Agency Beta");
    const person = agency.person("sgp");
    await openHubAs(page, person);

    for (const [opening, answer, scope] of [
      [agency.openings[0], "Not this Opening", "opening"],
      [agency.openings[1], "Not for 90 days", "sender"],
    ] as const) {
      const asked = await sent(
        await agency.send({ address: person.handle }, opening),
      );
      await pendingAt(person, asked);
      await page.goto(`${HUB_PORTAL}/messages/${asked.contact_id}`);
      await expect(
        page.getByText("Agency Beta asks to chat with you about this Opening"),
      ).toBeVisible();
      await page.getByRole("button", { name: answer }).click();
      await page
        .locator(".ant-popconfirm:visible")
        .getByRole("button", { name: answer })
        .click();
      await expect(page.getByText("Chat request declined.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
      const answered = await agencyRequestState(
        agency,
        "to_hub_user",
        asked.request_id,
        "declined",
      );
      expect(answered.decline_scope).toBe(scope);
    }
  });
});

test("Opening page: agencies show only to a signed-in person on an Opening they recruit for, who requests, is refused, declined, expired, and accepts", async ({
  page,
  request,
}) => {
  await withAgency(
    request,
    async (agency) => {
      const { consumer, provider } = agency.pair;
      const [first, second] = agency.openings;
      const person = agency.person("sgp");
      const openingPath = (opening: OpeningSuggestion) =>
        `${HUB_PORTAL}/org/${opening.consumer_domain}/openings/${opening.opening_number}`;
      const sectionTitle = page.getByText(
        "Agencies recruiting for this Opening",
      );
      const agencyRow = (name: string) =>
        page.getByRole("listitem").filter({ hasText: name });
      const agencies = () =>
        page.waitForResponse((response) =>
          response.url().endsWith("/api/hub/list-opening-agencies"),
        );

      // 1. Signed out, the Opening asks for sign-in and lists no agencies.
      await page.goto(openingPath(first));
      await expect(page).toHaveURL(/\/login/);
      await expect(sectionTitle).toHaveCount(0);

      // 2. Signed in, an Opening no agency recruits for shows none.
      const { opening: lone } = await publishedOpening(
        consumer.api,
        consumer.owner,
        consumer.org,
        { title: "Unassigned" },
      );
      await openHubAs(page, person);
      const listed = agencies();
      await page.goto(
        openingPath({
          consumer_domain: consumer.org.domain,
          opening_number: lone.opening_number,
        }),
      );
      expect((await listed).status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: "Unassigned", level: 1 }),
      ).toBeVisible();
      await expect(sectionTitle).toHaveCount(0);

      // 3. Request chat with a note; the row turns pending, and Messages
      // shows the request waiting.
      await page.goto(openingPath(first));
      await expect(sectionTitle).toBeVisible();
      await agencyRow("Agency Beta")
        .getByRole("button", { name: "Request chat" })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Request a chat with Agency Beta",
      });
      await expect(dialog).toContainText("Engineer");
      await dialog
        .getByLabel("Note (optional)")
        .fill("I have built payment platforms for six years.");
      await dialog.getByRole("button", { name: "Send request" }).click();
      await expect(
        page.getByText("Chat request sent to Agency Beta."),
      ).toBeVisible();
      await expect(agencyRow("Agency Beta")).toContainText("Request pending");
      const asked = await awaitHubRequest(
        person,
        "to_agency",
        (item) => item.state === "pending",
      );
      await page.goto(`${HUB_PORTAL}/messages/${asked.contact_id}`);
      await expect(
        page.getByText(
          /Your chat request, sent .+, is waiting for Agency Beta to answer\./,
        ),
      ).toBeVisible();

      // 4. The agency declines for a window: both pages show the lift date.
      const declined = await provider.api.declineChatRequest(provider.owner, {
        request_id: asked.request_id,
        scope: "sender",
      });
      expect(declined.status(), await declined.text()).toBe(200);
      await awaitHubRequest(
        person,
        "to_agency",
        (item) =>
          item.request_id === asked.request_id && item.state === "declined",
      );
      await page.reload();
      await expect(
        page.getByText(/Agency Beta declined your chat requests until .+\./),
      ).toBeVisible();
      await page.goto(openingPath(first));
      await expect(agencyRow("Agency Beta")).toContainText(/Declined until .+/);
      await expect(
        agencyRow("Agency Beta").getByRole("button", { name: "Request chat" }),
      ).toHaveCount(0);

      await withRival(
        request,
        agency,
        "sgp",
        [second],
        async (rival) => {
          const rivalRow = agencyRow("Agency Gamma");
          const rivalDialog = page.getByRole("dialog", {
            name: "Request a chat with Agency Gamma",
          });

          // 5. A request that crossed in the meantime is refused in the dialog.
          await page.goto(openingPath(second));
          await rivalRow.getByRole("button", { name: "Request chat" }).click();
          await expect(rivalDialog).toBeVisible();
          const crossed = await personAsks(
            agency,
            person,
            second,
            rival.org.domain,
          );
          await rivalDialog
            .getByRole("button", { name: "Send request" })
            .click();
          await expect(
            rivalDialog.getByText(
              "A chat request between you and this agency is already waiting for an answer.",
            ),
          ).toBeVisible();
          await rivalDialog.getByRole("button", { name: "Cancel" }).click();
          await expect(rivalRow).toContainText("Request pending");

          // 6. Unanswered, it expires: Messages says so and the row offers a
          // new request.
          backdateRequest(rival.tenant, crossed.request_id);
          await awaitHubRequest(
            person,
            "to_agency",
            (item) =>
              item.request_id === crossed.request_id &&
              item.state === "expired",
          );
          await page.goto(`${HUB_PORTAL}/messages/${crossed.contact_id}`);
          await expect(
            page.getByText(
              /Your chat request of .+ expired before Agency Gamma answered\./,
            ),
          ).toBeVisible();
          await page.goto(openingPath(second));
          await expect(
            rivalRow.getByRole("button", { name: "Request chat" }),
          ).toBeVisible();

          // 7. The agency asks instead: View request leads to Messages, and
          // Accept opens the conversation at once.
          const offered = await rival.api.sendChatRequest(
            rival.owner,
            { address: person.handle, suggestion: second },
            orgsIdempotencyKey(),
          );
          expect(offered.status(), await offered.text()).toBe(200);
          const incoming = await awaitHubRequest(
            person,
            "to_hub_user",
            (item) => item.state === "pending",
          );
          await page.reload();
          await rivalRow.getByRole("button", { name: "View request" }).click();
          await expect(page).toHaveURL(
            `${HUB_PORTAL}/messages/${incoming.contact_id}`,
          );
          await expect(
            page.getByText(
              "Agency Gamma asks to chat with you about this Opening",
            ),
          ).toBeVisible();
          await page.goBack();
          await rivalRow.getByRole("button", { name: "Accept" }).click();
          await expect(
            page.getByText("You can now write to Agency Gamma."),
          ).toBeVisible();
          await rivalRow
            .getByRole("button", { name: "Open conversation" })
            .click();
          await expect(page).toHaveURL(
            `${HUB_PORTAL}/messages/${incoming.contact_id}`,
          );
          await expect(page.getByPlaceholder("Write a reply")).toBeVisible();

          // 8. Once the agency's window lapses, the person is told why and
          // pointed to the Opening it suggested.
          sqlScalarForTenant(
            rival.tenant,
            `UPDATE vetchium.org_conversations
         SET agency_activity_at = now() - interval '91 days'
         WHERE contact_id = ${sqlLiteral(incoming.contact_id)}::uuid`,
          );
          await page.reload();
          await expect(
            page.getByText("You can't write to Agency Gamma now"),
          ).toBeVisible();
          await expect(
            page.getByRole("link", { name: "Designer" }).last(),
          ).toBeVisible();
          await expect(page.getByPlaceholder("Write a reply")).toHaveCount(0);
        },
        "Agency Gamma",
      );
    },
    "Agency Beta",
  );
});
