import type {
  ChatRequest,
  ListChatRequestsResponse,
} from "typespec/orgs/marketplace/contacts/contacts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { cleanupApplicant, seedApplicant } from "../lib/hub-applicant.ts";
import { addOrgMember, inviteeAddress, orgDID } from "../lib/orgs-api.ts";
import {
  accepted,
  agencyRequestState,
  backdate,
  backdateRequest,
  orgRequests,
  pendingAt,
  personAsks,
  sent,
  withAgency,
} from "../lib/orgs-chat-requests.ts";
import {
  activate,
  asProvider,
  awaitHubPointer,
  awaitHubRequest,
  awaitRequestsOff,
} from "../lib/orgs-marketplace.ts";
import { assign, withWorld } from "../lib/orgs-routing.ts";
import { sidebarPage, signIn } from "../lib/orgs-ui.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";

test.describe.configure({ timeout: 240_000 });

test("agency person page: found by alias at its handle, a note makes the Contact, a chat request opens the conversation, notes are kept, and the agency deletes only its own message", async ({
  page,
  request,
}) => {
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;

    // Activate sourcing engagement and assign whole to the opening
    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);

    // Seed applicant in consumer tenant
    const applicant = seedApplicant(request, consumer.tenant);
    const personPath = `${ORGS_PORTAL}/sourcing/contacts/${applicant.handle}`;

    try {
      // 1. Sign in to Orgs UI as provider owner
      await signIn(page, provider.org, provider.tenant);

      // 2. Contacts offers to find a person while it holds none.
      await page.goto(`${ORGS_PORTAL}/sourcing/contacts`);
      await expect(
        page.getByRole("heading", { name: "Contacts", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "Not contacted" }),
      ).toHaveCount(0);
      for (const tab of ["All", "Requests", "Unread", "Conversations"]) {
        await expect(
          page.getByRole("tab", { name: `${tab} (0)` }),
        ).toBeVisible();
      }
      await page.getByRole("button", { name: "Find a person" }).first().click();
      const findModal = page.getByRole("dialog", {
        name: "Find a person on Vetchium",
      });
      await findModal.getByPlaceholder("handle or alias").fill(applicant.alias);
      await findModal.getByRole("button", { name: "View profile" }).click();

      // The alias lands on the person's handle, which never changes.
      await expect(page).toHaveURL(personPath);
      await expect(
        page.getByRole("heading", { name: "Ada Applicant" }),
      ).toBeVisible();
      await expect(
        page.getByText("Ada is not in your contacts yet."),
      ).toBeVisible();
      await expect(page.getByText(/Contact since/)).toHaveCount(0);

      // The request dialog opens over a person who is not a Contact yet.
      await page.getByRole("button", { name: "Send chat request" }).click();
      const firstRequestModal = page.getByRole("dialog", {
        name: "Send chat request",
      });
      await expect(
        firstRequestModal.getByText(`@${applicant.handle}`),
      ).toBeVisible();
      await firstRequestModal.getByRole("button", { name: "Cancel" }).click();
      await expect(firstRequestModal).toBeHidden();
      await expect(
        page.getByText("Ada is not in your contacts yet."),
      ).toBeVisible();

      // A note makes the person a Contact on the same page.
      await page
        .getByPlaceholder("Add a note for your agency")
        .fill("Strong distributed systems background.");
      await page.getByRole("button", { name: "Add note" }).click();
      await expect(
        page.getByText("No conversation", { exact: true }),
      ).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${personPath}(\\?|$)`));

      // Verify contact is listed in Contacts table
      await page.goto(`${ORGS_PORTAL}/sourcing/contacts`);
      await expect(page.getByRole("tab", { name: "All (1)" })).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Ada Applicant" }),
      ).toBeVisible();
      await expect(page.getByText(`@${applicant.handle}`)).toBeVisible();
      await expect(
        page.getByRole("row", { name: /Ada Applicant/ }),
      ).toContainText("No conversation");
      await page.getByRole("link", { name: "Ada Applicant" }).click();
      await expect(page).toHaveURL(personPath);

      // 3. Ask Ada to chat from her Contact; she accepts.
      await page.getByRole("button", { name: "Send chat request" }).click();
      const requestModal = page.getByRole("dialog", {
        name: "Send chat request",
      });
      await requestModal.getByRole("combobox", { name: "Opening" }).click();
      await page
        .locator(".ant-select-dropdown:visible .ant-select-item-option")
        .first()
        .click();
      await requestModal
        .getByLabel("Note (optional)")
        .fill("We came across your profile and would love to connect.");
      await requestModal.getByRole("button", { name: "Send request" }).click();
      await expect(
        page.getByText("Chat request sent to Ada Applicant."),
      ).toBeVisible();
      await expect(
        page.getByText(/Waiting for Ada Applicant to answer\./),
      ).toBeVisible();
      await expect(
        page.getByText("Request sent", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Send chat request" }),
      ).toHaveCount(0);
      const listed = await provider.api.listChatRequests(provider.owner, {
        direction: "to_hub_user",
      });
      expect(listed.status(), await listed.text()).toBe(200);
      const toAda = (
        (await listed.json()) as ListChatRequestsResponse
      ).items.find((item) => item.hub_user_handle === applicant.handle);
      expect(toAda).toBeDefined();
      await accepted(applicant, toAda as ChatRequest);
      await page.reload();

      // The accepted request opens the conversation with its note.
      await expect(
        page.getByRole("tab", { name: "Conversation" }),
      ).toBeVisible();
      await expect(
        page.getByText("In conversation", { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("tabpanel", { name: "Conversation" })
          .getByText("We came across your profile and would love to connect."),
      ).toBeVisible();
      await expect(page.getByPlaceholder("Write a message")).toBeEnabled();

      // The agency deletes its own message, never the request; a stub stays.
      await page
        .getByPlaceholder("Write a message")
        .fill("A message we take back.");
      await page.getByRole("button", { name: /Send$/ }).click();
      const conversationPanel = page.getByRole("tabpanel", {
        name: "Conversation",
      });
      await expect(
        conversationPanel.getByText("A message we take back."),
      ).toBeVisible();
      const deleteButtons = conversationPanel.getByRole("button", {
        name: "Delete message",
      });
      await expect(deleteButtons).toHaveCount(1);
      await deleteButtons.click();
      await page
        .locator(".ant-popconfirm:visible")
        .getByRole("button", { name: "Delete" })
        .click();
      await expect(
        conversationPanel.getByText("Message deleted", { exact: true }),
      ).toBeVisible();
      await expect(
        conversationPanel.getByText("A message we take back."),
      ).toHaveCount(0);
      await expect(deleteButtons).toHaveCount(0);

      // 4. Suggest an opening
      await page.getByRole("button", { name: "Suggest an Opening" }).click();
      const suggestModal = page.getByRole("dialog");
      await expect(suggestModal).toBeVisible();

      // Dropdown should allow selecting opening
      const selectOpening = suggestModal.locator(".ant-select");
      await selectOpening.click();
      await page
        .locator(".ant-select-dropdown:visible .ant-select-item-option-content")
        .first()
        .click();

      await suggestModal
        .getByRole("button", { name: "Send suggestion" })
        .click();
      await expect(suggestModal).toBeHidden();

      // Verify suggested opening card appears in conversation feed
      await expect(page.getByText("Opening suggestion")).toBeVisible();

      // The tab is kept in the URL, so a reload stays on it.
      await page.getByRole("tab", { name: /Suggested Openings/ }).click();
      await expect(page).toHaveURL(/tab=suggested_openings/);
      await page.reload();
      await expect(
        page
          .getByRole("tabpanel", { name: /Suggested Openings/ })
          .getByText(`#${opening.opening_number}`)
          .first(),
      ).toBeVisible();

      // 5. Notes tab: notes are edited and added, never deleted.
      await page.getByRole("tab", { name: /Notes/ }).click();
      const notesPanel = page.getByRole("tabpanel", { name: /Notes/ });
      await expect(
        notesPanel.getByText("Strong distributed systems background."),
      ).toBeVisible();

      // Edit note
      await notesPanel.getByRole("button", { name: "Edit" }).first().click();
      const editInput = notesPanel
        .locator("textarea")
        .filter({ hasText: "Strong distributed systems background." });
      await editInput.fill(
        "Updated: Strong distributed systems background and open to new roles.",
      );
      await notesPanel.getByRole("button", { name: "Save" }).click();
      await expect(
        notesPanel.getByText(
          "Updated: Strong distributed systems background and open to new roles.",
        ),
      ).toBeVisible();

      // Add a second note
      await notesPanel
        .getByPlaceholder("Add a note for your agency")
        .fill("Follow up after the first interview.");
      await notesPanel.getByRole("button", { name: "Add note" }).click();
      await expect(
        notesPanel.getByText("Follow up after the first interview."),
      ).toBeVisible();
      await expect(page.getByRole("tab", { name: "Notes (2)" })).toBeVisible();
      await expect(
        notesPanel.getByRole("button", { name: "Delete" }),
      ).toHaveCount(0);

      // 6. Chat requests off: tagged, but the conversation stays writable.
      await awaitHubPointer(applicant, provider.org.domain);
      const switched = await applicant.hub.setAgenciesMayMessage(
        applicant.token,
        { agencies_may_message: false },
      );
      expect(switched.status(), await switched.text()).toBe(204);
      await awaitRequestsOff(
        provider.api,
        provider.owner,
        applicant.handle,
        true,
      );
      await page.goto(personPath);

      await expect(
        page.getByText("Chat requests off", { exact: true }),
      ).toBeVisible();
      await expect(page.getByPlaceholder("Write a message")).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Suggest an Opening" }),
      ).toBeEnabled();
    } finally {
      cleanupApplicant(applicant, [
        {
          tenant: provider.tenant,
          did: orgDID(provider.org.domain, provider.tenant),
        },
      ]);
    }
  });
});

test("an agent works from their own Jobs, looks across the agency by colleague and client, and changes a Job's owner", async ({
  page,
  request,
}) => {
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;
    const openingTitle = opening.live_content?.title ?? "Opening";

    // Activate sourcing engagement and assign whole to the opening
    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);
    const colleague = await addOrgMember(
      provider.api,
      provider.owner,
      provider.org.domain,
      inviteeAddress(provider.org.domain, "agent"),
      ["org:fulfil_engagements"],
    );

    await signIn(page, provider.org, provider.tenant);
    const dropdown = page.locator(".ant-select-dropdown:visible");
    const row = page.getByRole("row", { name: new RegExp(openingTitle) });

    // 1. An agent starts on their own Jobs.
    await page.goto(`${ORGS_PORTAL}/sourcing/jobs`);
    await expect(
      page.getByRole("heading", { name: "Jobs", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No Jobs here are assigned to you.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show everyone's Jobs" }).click();
    await expect(page).toHaveURL(/owner=all/);
    await expect(row).toContainText("No owner");
    await expect(row).toContainText(consumer.org.domain);
    await expect(
      page.getByRole("columnheader", { name: /Credited applications/ }),
    ).toBeVisible();

    // 2. Anyone in the agency sets the owner; "Assign to me" is one click.
    await page
      .getByRole("button", { name: `Change the owner of ${openingTitle}` })
      .click();
    let dialog = page.getByRole("dialog", { name: "Job owner" });
    await dialog.getByRole("button", { name: "Assign to me" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText(`${provider.org.emailAddress} now owns this Job.`),
    ).toBeVisible();
    await expect(row).toContainText(`${provider.org.emailAddress} (you)`);
    await page.getByText("Mine", { exact: true }).click();
    await expect(page).not.toHaveURL(/owner=/);
    await expect(row).toBeVisible();

    // 3. Handing the Job to a colleague takes it off "Mine".
    await page
      .getByRole("button", { name: `Change the owner of ${openingTitle}` })
      .click();
    dialog = page.getByRole("dialog", { name: "Job owner" });
    await dialog
      .getByRole("combobox", { name: "Owner" })
      .fill(colleague.emailAddress.slice(0, 12));
    await dropdown.getByTitle(colleague.emailAddress, { exact: true }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(row).toHaveCount(0);

    // 4. One colleague's Jobs, then one client's, kept in the URL.
    await page.getByRole("combobox", { name: "Owned by…" }).fill("agent");
    await dropdown.getByTitle(colleague.emailAddress, { exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`owner=${encodeURIComponent(colleague.emailAddress)}`),
    );
    await expect(row).toContainText(colleague.emailAddress);
    await page
      .getByRole("combobox", { name: "Search clients" })
      .fill(consumer.org.domain.slice(0, 10));
    await dropdown.getByTitle(new RegExp(consumer.org.domain)).click();
    await expect(page).toHaveURL(/client=/);
    await page.reload();
    await expect(row).toBeVisible();

    // 5. A search that matches nothing offers to clear the filters.
    await page.getByLabel("Search title or number").fill("no-such-opening");
    await page.keyboard.press("Enter");
    await expect(page.getByText("No Jobs match these filters.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(row).toBeVisible();

    // View job detail by clicking opening title link
    await page.getByRole("link", { name: openingTitle }).click();
    await expect(page).toHaveURL(
      new RegExp(`/sourcing/jobs/${sourcing.id}/${opening.opening_number}`),
    );
    await expect(
      page.getByRole("heading", { name: openingTitle }),
    ).toBeVisible();
    await expect(page.getByTestId("job-owner")).toHaveText(
      colleague.emailAddress,
    );

    // Tabs in Job detail
    await expect(page.getByRole("tab", { name: "Opening" })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /Credited applications/ }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: /Suggested to/ })).toBeVisible();

    // 2. Credited applications page
    await page.goto(`${ORGS_PORTAL}/sourcing/credited-applications`);
    await expect(
      page.getByRole("heading", { name: "Credited applications", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("In progress")).toBeVisible();
    await expect(page.getByText("Hired")).toBeVisible();
  });
});

test("chat requests: an agency sends from a Job, meets each refusal, answers people's requests, and sees every request state", async ({
  page,
  request,
}) => {
  await withAgency(request, async (agency) => {
    const { provider } = agency.pair;
    const [opening] = agency.openings;
    const jobPath = `${ORGS_PORTAL}/sourcing/jobs/${agency.engagementID}/${opening.opening_number}`;
    const contactPath = (id: string) =>
      `${ORGS_PORTAL}/sourcing/contacts/${id}`;
    const dialog = page.getByRole("dialog", { name: "Send chat request" });
    const sendButton = dialog.getByRole("button", { name: "Send request" });
    const popconfirm = page.locator(".ant-popconfirm:visible");
    const dana = agency.person("sgp", "Dana Declines");
    const arjun = agency.person("sgp", "Arjun Asks");
    const priya = agency.person("sgp", "Priya Picky");
    const nia = agency.person("sgp", "Nia Nope");
    const bo = agency.person("sgp", "Bo Busy");
    const wen = agency.person("sgp", "Wen Waits");

    await signIn(page, provider.org, provider.tenant);
    const fromJob = async (handle: string) => {
      await page.goto(jobPath);
      await page.getByRole("button", { name: "Send chat request" }).click();
      await dialog.getByLabel("Person").fill(handle);
    };

    // 1. From a Job, by handle; the agency lands on the Contact.
    await fromJob(dana.handle);
    await dialog
      .getByLabel("Note (optional)")
      .fill("Your platform work fits this Engineer role.");
    await sendButton.click();
    await expect(
      page.getByText("Chat request sent to Dana Declines."),
    ).toBeVisible();
    await expect(page).toHaveURL(contactPath(dana.handle));
    await expect(
      page.getByText(/Waiting for Dana Declines to answer\./),
    ).toBeVisible();

    // 2. A second request to her is refused before sending.
    await fromJob(dana.handle);
    await expect(
      dialog.getByText(
        /Your agency's chat request to Dana Declines, sent .*, is still waiting for an answer\./,
      ),
    ).toBeVisible();
    await expect(sendButton).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // 3. She declines for a window: the Contact shows the lift date, and
    // a new request from the Contact is refused.
    const toDana = (await orgRequests(agency, "to_hub_user")).find(
      (item) => item.hub_user_handle === dana.handle,
    );
    expect(toDana).toBeDefined();
    await pendingAt(dana, toDana as ChatRequest);
    const declined = await dana.hub.declineChatRequest(dana.token, {
      agency_domain: provider.org.domain,
      request_number: (toDana as ChatRequest).request_number,
      scope: "sender",
    });
    expect(declined.status(), await declined.text()).toBe(200);
    await agencyRequestState(
      agency,
      "to_hub_user",
      toDana as ChatRequest,
      "declined",
    );
    await page.goto(contactPath(dana.handle));
    await expect(
      page.getByText(
        /Dana Declines declined your agency's chat requests until .+\./,
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Send chat request" }).click();
    await expect(
      dialog.getByText(
        /Dana Declines declined your agency's chat requests until .+\./,
      ),
    ).toBeVisible();
    await expect(sendButton).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // 4. People ask the agency: the navigation counts them and the
    // Requests tab lists the Contacts with a pending request; the answered
    // one stays under All with its status.
    for (const person of [arjun, priya, nia, bo]) {
      const sentRequest = await personAsks(agency, person, opening);
      await agencyRequestState(
        agency,
        "to_agency",
        {
          hub_user_handle: person.handle,
          request_number: sentRequest.request_number,
        },
        "pending",
      );
    }
    await page.goto(`${ORGS_PORTAL}/sourcing/contacts?tab=requests`);
    await expect(sidebarPage(page, "Contacts")).toContainText("4");
    await expect(page.getByRole("tab", { name: "Requests (4)" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Bo Busy/ })).toContainText(
      "Request received",
    );
    await expect(page.getByRole("row", { name: /Dana Declines/ })).toHaveCount(
      0,
    );
    await page.getByRole("tab", { name: "All (5)" }).click();
    // All is the default tab, so the URL drops it.
    await expect(page).toHaveURL(`${ORGS_PORTAL}/sourcing/contacts`);
    await expect(
      page.getByRole("row", { name: /Dana Declines/ }),
    ).toContainText("Request declined");

    // 5. Requesting someone who already asked offers Accept instead.
    await fromJob(bo.handle);
    await expect(
      dialog.getByText(
        "Bo Busy has already asked to chat with your agency. Accept their request to start the conversation.",
      ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Accept" }).click();
    await expect(
      page.getByText("You accepted the chat request from Bo Busy."),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Write a message")).toBeVisible();

    // 6. Answering on the Contact: accept, then each decline.
    await page.goto(contactPath(arjun.handle));
    await expect(
      page.getByText(/Arjun Asks asked to chat with your agency on /),
    ).toBeVisible();
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(
      page.getByText("You accepted the chat request from Arjun Asks."),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Write a message")).toBeVisible();

    await fromJob(arjun.handle);
    await expect(
      dialog.getByText(
        "You can already write to Arjun Asks in your conversation.",
      ),
    ).toBeVisible();
    await expect(sendButton).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    for (const [person, answer, scope] of [
      [priya, "Not this Opening", "opening"],
      [nia, "Not for 90 days", "sender"],
    ] as const) {
      await page.goto(contactPath(person.handle));
      await page.getByRole("button", { name: answer }).click();
      await popconfirm.getByRole("button", { name: answer }).click();
      await expect(page.getByText("Chat request declined.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
      const answered = await awaitHubRequest(
        person,
        "to_agency",
        (item) => item.state === "declined",
      );
      expect(answered.decline_scope).toBe(scope);
    }

    // 7. Once Arjun's window lapses the Contact says why, and suggesting
    // the Opening to him hands off to a chat request.
    backdate(agency, arjun.handle, "hub_activity_at");
    await page.goto(contactPath(arjun.handle));
    await expect(
      page.getByText(
        "You cannot write to Arjun now. The conversation reopens when Arjun writes or accepts a new chat request.",
      ),
    ).toBeVisible();
    await page.goto(jobPath);
    await page.getByRole("button", { name: "Suggest to a contact" }).click();
    const suggest = page.getByRole("dialog", { name: "Suggest to a contact" });
    await suggest.getByRole("combobox", { name: "Contact" }).fill("Arjun");
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText("Arjun Asks")
      .click();
    await expect(
      suggest.getByText(
        "You can't write to Arjun Asks now, so this sends a chat request with this Opening instead.",
      ),
    ).toBeVisible();
    await suggest.getByRole("button", { name: "Send chat request" }).click();
    await expect(dialog).toBeVisible();
    await expect(sendButton).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // 8. An unanswered request expires; a person who turns requests off
    // is refused before sending.
    const toWen = await sent(
      await agency.send({ address: wen.handle }, opening),
    );
    backdateRequest(agency, toWen);
    await agencyRequestState(agency, "to_hub_user", toWen, "expired");
    await page.goto(contactPath(wen.handle));
    await expect(
      page.getByText(
        /Your chat request of .+ expired before Wen Waits answered\./,
      ),
    ).toBeVisible();
    const off = await wen.hub.setAgenciesMayMessage(wen.token, {
      agencies_may_message: false,
    });
    expect(off.status(), await off.text()).toBe(204);
    await awaitRequestsOff(provider.api, provider.owner, wen.handle, true);
    await page.reload();
    await page.getByRole("button", { name: "Send chat request" }).click();
    await expect(
      dialog.getByText(
        "This person does not accept chat requests from agencies",
      ),
    ).toBeVisible();
    await expect(sendButton).toBeDisabled();
  });
});
