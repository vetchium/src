import type { LoginAttempt as SharedLoginAttempt } from "@vetchium/portal-ui/auth";
import { createPortalAuth } from "@vetchium/portal-ui/auth";
import type { LoginTOTPRequiredResponse } from "typespec/orgs/auth/login";
import type {
  AuthenticatedSessionResponse,
  OrgLoginChallengeToken,
  OrgSessionToken,
} from "typespec/orgs/auth/types";
import { sessionExpiredEvent } from "../api/client";
import { orgsAPI } from "../api/orgs";
import {
  clearSession,
  type OrgSession,
  readSession,
  storeSession,
} from "./session";

export type LoginAttempt = SharedLoginAttempt;

/** The region a sign-in was sent to: its challenge and session belong there. */
interface SignInRegion {
  tenantId: string;
}

type PendingChallenge = LoginTOTPRequiredResponse & SignInRegion;

const auth = createPortalAuth<
  AuthenticatedSessionResponse,
  OrgSession,
  LoginTOTPRequiredResponse,
  PendingChallenge,
  SignInRegion,
  SignInRegion,
  OrgSessionToken,
  OrgLoginChallengeToken
>({
  sessionExpiredEvent,
  readSession,
  storeSession: (session, { tenantId }) =>
    storeSession(session.session_token, tenantId),
  clearSession,
  sessionToken: (session) => session.token,
  preferredLanguage: (session) => session.preferred_language,
  logout: (session) => orgsAPI.logout(session.token, session.tenantId),
  // Sign-out must leave this browser signed out even when the API cannot be
  // reached; the server session then expires on its own.
  ignoreLogoutFailure: true,
  challengeToken: (challenge) => challenge.login_challenge_token,
  pendingChallenge: (challenge, { tenantId }) => ({ ...challenge, tenantId }),
});

export const AuthProvider = auth.AuthProvider;
export const useAuth = auth.useAuth;
