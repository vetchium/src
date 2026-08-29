import { createTokenSessionStorage } from "@vetchium/portal-ui/session";
import type { AdminSessionToken } from "typespec/admin/auth/types";

const storage = createTokenSessionStorage<AdminSessionToken>(
  "vetchium.admin.session-token",
);

export const getSessionToken = storage.read;
export const setSessionToken = storage.store;
export const clearSessionToken = storage.clear;
