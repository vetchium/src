import type { HubAlias } from "../../directory/directory.ts";
import { isHubAlias } from "../../directory/directory.ts";

export interface AliasState {
  profile_alias: HubAlias | null;
  next_change_at?: string;
}

export interface SetAliasRequest {
  profile_alias: HubAlias | null;
}

export function validateSetAliasRequest(value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return ["profile_alias"];
  }
  const alias = (value as Record<string, unknown>).profile_alias;
  return alias === null || isHubAlias(alias) ? [] : ["profile_alias"];
}
