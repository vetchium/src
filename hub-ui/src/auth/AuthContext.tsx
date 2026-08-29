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
  readSession,
  type StoredSession,
  storeSession,
} from "./session";

interface PendingChallenge extends LoginTOTPRequiredResponse {
  remembered: boolean;
}

const auth = createPortalAuth<
  AuthenticatedSessionResponse,
  StoredSession,
  LoginTOTPRequiredResponse,
  PendingChallenge,
  boolean,
  boolean,
  HubSessionToken,
  HubLoginChallengeToken
>({
  sessionExpiredEvent: "vetchium:hub-session-expired",
  readSession,
  storeSession,
  clearSession,
  sessionToken: (session) => session.session_token,
  preferredLanguage: (session) => session.preferred_language,
  logout: (session) => hubAPI.logout(session.session_token),
  ignoreLogoutFailure: true,
  challengeToken: (challenge) => challenge.login_challenge_token,
  pendingChallenge: (challenge, remembered) => ({ ...challenge, remembered }),
  updateSession: (session, updates) =>
    storeSession({ ...session, ...updates }, session.remembered),
});

export const AuthProvider = auth.AuthProvider;
export const useAuth = auth.useAuth;
