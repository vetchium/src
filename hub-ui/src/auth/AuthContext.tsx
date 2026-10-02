import { createPortalAuth } from "@vetchium/portal-ui/auth";
import type { LoginTOTPRequiredResponse } from "typespec/hub/auth/login";
import type {
  AuthenticatedSessionResponse,
  HubLoginChallengeToken,
  HubSessionToken,
} from "typespec/hub/auth/types";
import { hubAPI } from "../api/hub";
import {
  clearSession,
  type HubSession,
  readSession,
  type SessionMetadata,
  storeSession,
} from "./session";

/** A TOTP challenge and the sign-in it continues, including the region that
 * issued it: verification must go back to that region. */
interface PendingChallenge extends LoginTOTPRequiredResponse, SessionMetadata {}

const auth = createPortalAuth<
  AuthenticatedSessionResponse,
  HubSession,
  LoginTOTPRequiredResponse,
  PendingChallenge,
  SessionMetadata,
  SessionMetadata,
  HubSessionToken,
  HubLoginChallengeToken
>({
  sessionExpiredEvent: "vetchium:hub-session-expired",
  readSession,
  storeSession,
  clearSession,
  sessionToken: (session) => session.session_token,
  preferredLanguage: (session) => session.preferred_language,
  logout: (session) => hubAPI.logout(session.session_token, session.tenantId),
  ignoreLogoutFailure: true,
  challengeToken: (challenge) => challenge.login_challenge_token,
  pendingChallenge: (challenge, metadata) => ({ ...challenge, ...metadata }),
  updateSession: (session, updates) =>
    storeSession(
      { ...session, ...updates },
      { remembered: session.remembered, tenantId: session.tenantId },
    ),
});

export const AuthProvider = auth.AuthProvider;
export const useAuth = auth.useAuth;
