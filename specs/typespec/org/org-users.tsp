import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Org Session Token - returned after successful TFA verification
scalar OrgSessionToken extends string;

// Org TFA Token - returned after initial login for TFA verification
scalar OrgTFAToken extends string;

// Org Signup Token - DNS-based verification token
scalar OrgSignupToken extends string;

// Org Invitation Token - for invited users to complete setup
scalar OrgInvitationToken extends string;

// Org Password Reset Token - for password reset flow
scalar OrgPasswordResetToken extends string;

// Org portal routes
@route("/org")
interface OrgPortal {
  @route("/init-signup") @post initSignup(@body body: OrgInitSignupRequest): OrgInitSignupResponse | BadRequestResponse;
  @route("/get-signup-details") @post getSignupDetails(@body body: OrgGetSignupDetailsRequest): OrgGetSignupDetailsResponse | BadRequestResponse;
  @route("/complete-signup") @post completeSignup(@body body: OrgCompleteSignupRequest): OrgCompleteSignupResponse | BadRequestResponse;
  @route("/login") @post login(@body body: OrgLoginRequest): OrgLoginResponse | BadRequestResponse;
  @route("/tfa") @post tfa(@body body: OrgTFARequest): OrgTFAResponse | BadRequestResponse;
  @route("/logout") @post logout(): NoContentResponse | UnauthorizedResponse;
  @route("/myinfo") @get myInfo(): OrgMyInfoResponse | UnauthorizedResponse;
  @route("/invite-user") @post inviteUser(@body body: OrgInviteUserRequest): OrgInviteUserResponse | BadRequestResponse;
  @route("/complete-setup") @post completeSetup(@body body: OrgCompleteSetupRequest): OrgCompleteSetupResponse | BadRequestResponse;
  @route("/disable-user") @post disableUser(@body body: OrgDisableUserRequest): NoContentResponse | BadRequestResponse;
  @route("/enable-user") @post enableUser(@body body: OrgEnableUserRequest): NoContentResponse | BadRequestResponse;
  @route("/filter-users") @post filterUsers(@body body: FilterOrgUsersRequest): FilterOrgUsersResponse | BadRequestResponse;
  @route("/assign-role") @post assignRole(@body body: AssignRoleRequest): NoContentResponse | BadRequestResponse;
  @route("/remove-role") @post removeRole(@body body: RemoveRoleRequest): NoContentResponse | BadRequestResponse;
  @route("/change-password") @post changePassword(@body body: OrgChangePasswordRequest): NoContentResponse | BadRequestResponse;
  @route("/request-password-reset") @post requestPasswordReset(@body body: OrgRequestPasswordResetRequest): OrgRequestPasswordResetResponse | BadRequestResponse;
  @route("/complete-password-reset") @post completePasswordReset(@body body: OrgCompletePasswordResetRequest): NoContentResponse | BadRequestResponse;
  @route("/set-language") @post setLanguage(@body body: OrgSetLanguageRequest): NoContentResponse | BadRequestResponse;
  @route("/filter-audit-logs") @post filterAuditLogs(@body body: FilterAuditLogsRequest): FilterAuditLogsResponse | BadRequestResponse;
}

model OrgInitSignupRequest {
  email: EmailAddress;
  home_region: string;
}

model OrgInitSignupResponse {
  domain: DomainName;
  dns_record_name: string;
  token_expires_at: string;
  message: string;
}

model OrgGetSignupDetailsRequest {
  signup_token: OrgSignupToken;
}

model OrgGetSignupDetailsResponse {
  domain: DomainName;
}

model OrgCompleteSignupRequest {
  signup_token: OrgSignupToken;
  password: Password;
  preferred_language: LanguageCode;
  has_added_dns_record: boolean;
  agrees_to_eula: boolean;
}

model OrgCompleteSignupResponse {
  session_token: OrgSessionToken;
  org_user_id: string;
}

model OrgLoginRequest {
  email: EmailAddress;
  domain: DomainName;
  password: Password;
}

model OrgLoginResponse {
  tfa_token: OrgTFAToken;
}

model OrgTFARequest {
  tfa_token: OrgTFAToken;
  tfa_code: TFACode;
  remember_me: boolean;
}

model OrgTFAResponse {
  session_token: OrgSessionToken;
  preferred_language: LanguageCode;
  org_name: string;
}

model OrgInviteUserRequest {
  email_address: EmailAddress;
  invite_email_language?: LanguageCode;
  roles: string[];
}

model OrgInviteUserResponse {
  invitation_id: string;
  expires_at: string;
}

model OrgCompleteSetupRequest {
  invitation_token: OrgInvitationToken;
  password: Password;
  full_name: FullName;
  preferred_language?: LanguageCode;
}

model OrgCompleteSetupResponse {
  message: string;
}

model OrgDisableUserRequest {
  email_address: EmailAddress;
}

model OrgEnableUserRequest {
  email_address: EmailAddress;
}

model OrgRequestPasswordResetRequest {
  email_address: EmailAddress;
  domain: DomainName;
}

model OrgRequestPasswordResetResponse {
  message: string;
}

model OrgCompletePasswordResetRequest {
  reset_token: OrgPasswordResetToken;
  new_password: Password;
}

model OrgChangePasswordRequest {
  current_password: Password;
  new_password: Password;
}

model FilterOrgUsersRequest {
  limit?: int32;
  cursor?: string;
  filter_email?: string;
  filter_name?: string;
  filter_status?: string;
}

model OrgUserItem {
  email_address: EmailAddress;
  name: string;
  status: string;
  created_at: string;
  roles: string[];
}

model FilterOrgUsersResponse {
  items: OrgUserItem[];
  next_cursor: string;
}

model OrgSetLanguageRequest {
  language: LanguageCode;
}

model OrgMyInfoResponse {
  org_user_id: string;
  full_name: string;
  preferred_language: LanguageCode;
  org_name: string;
  roles: string[];
}
