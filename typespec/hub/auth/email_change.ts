import type { EmailAddress } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";

export type HubEmailChangeChallengeID = string;

export function isHubEmailChangeChallengeID(
  value: HubEmailChangeChallengeID,
): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    value,
  );
}

export interface RequestEmailChangeRequest {
  new_email_address: EmailAddress;
}

export function normalizeRequestEmailChangeRequest(
  request: RequestEmailChangeRequest,
): RequestEmailChangeRequest {
  return {
    ...request,
    new_email_address: normalizeEmailAddress(request.new_email_address),
  };
}

export function validateRequestEmailChangeRequest(
  request: RequestEmailChangeRequest,
): string[] {
  return isEmailAddress(normalizeEmailAddress(request.new_email_address))
    ? []
    : ["new_email_address"];
}

export interface EmailChangeChallenge {
  challenge_id: HubEmailChangeChallengeID;
  expires_at: string;
}

export interface ConfirmEmailChangeRequest {
  challenge_id: HubEmailChangeChallengeID;
  code: string;
}

export function validateConfirmEmailChangeRequest(
  request: ConfirmEmailChangeRequest,
): string[] {
  const fields: string[] = [];
  if (!isHubEmailChangeChallengeID(request.challenge_id)) {
    fields.push("challenge_id");
  }
  if (!/^[0-9]{6}$/.test(request.code)) fields.push("code");
  return fields;
}
