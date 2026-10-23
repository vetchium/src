import { expect, test } from "../lib/admin-fixtures.ts";
import { cleanupApplicant, seedApplicant } from "../lib/hub-applicant.ts";
import { orgDID, orgSQL } from "../lib/orgs-api.ts";
import { activate, asProvider } from "../lib/orgs-marketplace.ts";
import { assign, withWorld } from "../lib/orgs-routing.ts";
import { signIn } from "../lib/orgs-ui.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";

test.describe.configure({ timeout: 240_000 });

test("agency contact lifecycle: creates contact with note, starts conversation, suggests opening, edits/deletes notes, and respects messages-off", async ({
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

    try {
      // 1. Sign in to Orgs UI as provider owner
      await signIn(page, provider.org, provider.tenant);

      // 2. Navigate to /contacts
      await page.goto(`${ORGS_PORTAL}/contacts`);
      await expect(
        page.getByRole("heading", { name: "Contacts", exact: true }),
      ).toBeVisible();

      // Open "New contact" modal
      await page.getByRole("button", { name: "New contact" }).click();
      const findModal = page.getByRole("dialog");
      await expect(findModal).toBeVisible();

      // Enter applicant's handle and click "View profile"
      await findModal.getByPlaceholder("handle").fill(applicant.handle);
      await findModal.getByRole("button", { name: "View profile" }).click();

      // Navigated to /contacts/new?address=...
      await expect(page).toHaveURL(
        new RegExp(`/contacts/new\\?address=${applicant.handle}`),
      );
      await expect(
        page.getByRole("heading", { name: "Ada Applicant" }),
      ).toBeVisible();

      // Add a note about this candidate
      await page
        .getByPlaceholder("Add a note for your agency")
        .fill("Strong distributed systems background.");
      await page.getByRole("button", { name: "Add note" }).click();

      // Redirects to Contact detail page (/contacts/:contactId)
      await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}/);
      await expect(
        page.getByRole("heading", { name: "Ada Applicant" }),
      ).toBeVisible();

      // Extract contact ID from URL
      const contactUrl = page.url();
      const contactID = (contactUrl.split("/contacts/")[1] ?? "").split("?")[0];
      expect(contactID).toBeTruthy();

      // Verify contact is listed in Contacts table
      await page.goto(`${ORGS_PORTAL}/contacts`);
      await expect(
        page.getByRole("link", { name: "Ada Applicant" }),
      ).toBeVisible();
      await expect(page.getByText(`@${applicant.handle}`)).toBeVisible();

      // Open contact detail by clicking candidate link in table
      await page.getByRole("link", { name: "Ada Applicant" }).click();
      await expect(page).toHaveURL(new RegExp(`/contacts/${contactID}`));

      // 3. Send first message to start conversation
      await page.getByRole("button", { name: "Send first message" }).click();
      const firstMsgModal = page.getByRole("dialog");
      await expect(firstMsgModal).toBeVisible();
      await firstMsgModal
        .getByPlaceholder("Write a message")
        .fill(
          "Hello Ada, we came across your profile and would love to connect.",
        );
      await firstMsgModal
        .getByRole("button", { name: "Send", exact: true })
        .click();
      await expect(firstMsgModal).toBeHidden();

      // Verify Conversation tab is now present and active
      await expect(
        page.getByRole("tab", { name: "Conversation" }),
      ).toBeVisible();

      // Verify message is in conversation feed
      await expect(
        page
          .getByRole("tabpanel", { name: "Conversation" })
          .getByText(
            "Hello Ada, we came across your profile and would love to connect.",
          ),
      ).toBeVisible();

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

      // Check Suggested openings tab
      await page.getByRole("tab", { name: /Suggested Openings/ }).click();
      await expect(
        page
          .getByRole("tabpanel", { name: /Suggested Openings/ })
          .getByText(`#${opening.opening_number}`),
      ).toBeVisible();

      // 5. Notes tab: edit and delete notes
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
        .fill("Temporary follow-up note.");
      await notesPanel.getByRole("button", { name: "Add note" }).click();
      await expect(
        notesPanel.getByText("Temporary follow-up note."),
      ).toBeVisible();

      // Delete the second note
      const tempNoteCard = notesPanel.locator(".ant-card", {
        hasText: "Temporary follow-up note.",
      });
      await tempNoteCard.getByRole("button", { name: "Delete" }).click();
      // Popconfirm "Delete"
      const confirmPopconfirm = page
        .locator(".ant-popconfirm:visible")
        .getByRole("button", { name: "Delete" });
      await confirmPopconfirm.click();
      await expect(tempNoteCard).toBeHidden();

      // 6. Messages-off state
      orgSQL(
        `UPDATE vetchium.org_contacts SET messages_off = true WHERE contact_id = '${contactID}'`,
        provider.tenant,
      );
      await page.reload();

      // Check warning message
      await expect(
        page.getByText("This person does not accept messages from agencies"),
      ).toBeVisible();
      await expect(
        page.getByPlaceholder("You can't write to this person right now."),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Suggest an Opening" }),
      ).toBeDisabled();
      await expect(page.getByRole("button", { name: /Send/ })).toBeDisabled();
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

test("agency views jobs list and detail, and credited applications page", async ({
  page,
  request,
}) => {
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { provider } = pair;
    const openingTitle = opening.live_content?.title ?? "Opening";

    // Activate sourcing engagement and assign whole to the opening
    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);

    await signIn(page, provider.org, provider.tenant);

    // 1. Jobs page
    await page.goto(`${ORGS_PORTAL}/jobs`);
    await expect(
      page.getByRole("heading", { name: "Jobs", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(openingTitle)).toBeVisible();
    await expect(page.getByText(/Playwright Org|example\.com/)).toBeVisible();

    // View job detail by clicking opening title link
    await page.getByRole("link", { name: openingTitle }).click();
    await expect(page).toHaveURL(
      new RegExp(`/jobs/${sourcing.id}/${opening.opening_number}`),
    );
    await expect(
      page.getByRole("heading", { name: openingTitle }),
    ).toBeVisible();

    // Tabs in Job detail
    await expect(page.getByRole("tab", { name: "Opening" })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /Credited applications/ }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: /Suggested to/ })).toBeVisible();

    // 2. Credited applications page
    await page.goto(`${ORGS_PORTAL}/credited-applications`);
    await expect(
      page.getByRole("heading", { name: "Credited applications", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("In progress")).toBeVisible();
    await expect(page.getByText("Hired")).toBeVisible();
  });
});
