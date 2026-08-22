import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import type { AdminUserID } from "typespec/admin/types";
import type {
  CompleteSetupResponse,
  InviteUserResponse,
} from "typespec/admin/users/invitations";
import { AdminAPI, idempotencyKey, responseJSON } from "./admin-api.ts";
import {
  cleanupAdmin,
  cleanupAdminIdempotency,
  createSeededManagerSession,
  emailCredential,
} from "./admin-db.ts";

export const SEEDED_ADMIN_EMAIL = "admin@sgp.example";
export const SEEDED_ADMIN_PASSWORD = "DevPassword123$";

export interface CreatedAdmin {
  adminUserID: AdminUserID;
  emailAddress: string;
  password: string;
  sessionToken: string;
}

interface AdminFixtures {
  adminAPI: AdminAPI;
  managerToken: string;
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
  managerToken: async ({ adminAPI }, use) => {
    const token = createSeededManagerSession();
    await use(token);
    await adminAPI.post("/logout", undefined, { token });
  },
  ownedEmail: async ({ request: _request }, use) => {
    const emails = new Set<string>();
    await use(() => {
      const email = `e2e+${randomUUID()}@example.test`;
      emails.add(email);
      return email;
    });
    for (const email of emails) cleanupAdmin(email);
  },
  createAdmin: async ({ adminAPI, managerToken, ownedEmail }, use) => {
    await use(async (options = {}) => {
      const emailAddress = ownedEmail();
      const password = options.password ?? `Vetchium!${randomUUID()}-password`;
      const invitation = await adminAPI.post(
        "/invite-user",
        { email_address: emailAddress, permissions: [] },
        { token: managerToken, idempotencyKey: idempotencyKey() },
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
          display_name: options.displayName ?? `E2E ${emailAddress}`,
          preferred_language: "en-US",
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
