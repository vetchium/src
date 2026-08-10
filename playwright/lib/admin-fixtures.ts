import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import type { AdminUserID } from "vetchium-specs/admin/types";
import type {
  CompleteSetupResponse,
  InviteUserResponse,
} from "vetchium-specs/admin/users/invitations";
import { AdminAPI, idempotencyKey, responseJSON } from "./admin-api.ts";
import {
  cleanupAdmin,
  cleanupAdminIdempotency,
  createSeededSuperadminSession,
  emailCredential,
} from "./admin-db.ts";

export const SEEDED_ADMIN_EMAIL = "admin@sgp.example";
export const SEEDED_ADMIN_PASSWORD = "dev_admin_password";

export interface CreatedAdmin {
  adminUserID: AdminUserID;
  emailAddress: string;
  password: string;
  sessionToken: string;
}

interface AdminFixtures {
  adminAPI: AdminAPI;
  superadminToken: string;
  ownedEmail: () => string;
  createAdmin: (options?: {
    displayName?: string;
    password?: string;
  }) => Promise<CreatedAdmin>;
}

export const test = base.extend<AdminFixtures>({
  adminAPI: async ({ request }, use) => {
    const keys = new Set<string>();
    await use(new AdminAPI(request, (key) => keys.add(key)));
    cleanupAdminIdempotency(keys);
  },
  superadminToken: async ({ adminAPI }, use) => {
    const token = createSeededSuperadminSession();
    await use(token);
    await adminAPI.post("/logout", undefined, { token });
  },
  ownedEmail: async (_args, use) => {
    const emails = new Set<string>();
    await use(() => {
      const email = `e2e+${randomUUID()}@example.test`;
      emails.add(email);
      return email;
    });
    for (const email of emails) cleanupAdmin(email);
  },
  createAdmin: async ({ adminAPI, superadminToken, ownedEmail }, use) => {
    await use(async (options = {}) => {
      const emailAddress = ownedEmail();
      const password = options.password ?? `Vetchium!${randomUUID()}-password`;
      const invitation = await adminAPI.post(
        "/invite-user",
        { email_address: emailAddress },
        { token: superadminToken, idempotencyKey: idempotencyKey() },
      );
      expect(invitation.status(), await invitation.text()).toBe(201);
      const invitationBody = await responseJSON<InviteUserResponse>(invitation);
      expect(invitationBody.admin_invitation_id).toMatch(/^[0-9a-f-]{36}$/);
      const invitationToken = emailCredential(
        emailAddress,
        "invitation",
        "invitation_token",
      );
      const setup = await adminAPI.post(
        "/complete-setup",
        {
          invitation_token: invitationToken,
          password,
          display_names: [
            {
              language_code: "en-US",
              display_name: options.displayName ?? `E2E ${emailAddress}`,
            },
          ],
          primary_display_name_language: "en-US",
          preferred_language: "en-US",
          preferred_timezone: "Etc/UTC",
        },
        { idempotencyKey: idempotencyKey() },
      );
      expect(setup.status(), await setup.text()).toBe(201);
      const { admin_user_id: adminUserID } =
        await responseJSON<CompleteSetupResponse>(setup);
      const session = await adminAPI.passwordSession(emailAddress, password);
      return {
        adminUserID,
        emailAddress,
        password,
        sessionToken: session.session_token,
      };
    });
  },
});

export { expect };
