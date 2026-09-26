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
  clearSessionToken,
  readSessionToken,
  storeSessionToken,
} from "./session";

export type LoginAttempt = SharedLoginAttempt;

const auth = createPortalAuth<
  AuthenticatedSessionResponse,
  OrgSessionToken,
  LoginTOTPRequiredResponse,
  LoginTOTPRequiredResponse,
  undefined,
  undefined,
  OrgSessionToken,
  OrgLoginChallengeToken
>({
  sessionExpiredEvent,
  readSession: readSessionToken,
  storeSession: (session) => {
    storeSessionToken(session.session_token);
    return session.session_token;
  },
  clearSession: clearSessionToken,
  sessionToken: (token) => token,
  preferredLanguage: (session) => session.preferred_language,
  logout: (token) => orgsAPI.logout(token),
  // Sign-out must leave this browser signed out even when the API cannot be
  // reached; the server session then expires on its own.
  ignoreLogoutFailure: true,
  challengeToken: (challenge) => challenge.login_challenge_token,
  pendingChallenge: (challenge) => challenge,
});

export const AuthProvider = auth.AuthProvider;
export const useAuth = auth.useAuth;
