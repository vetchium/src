import type { LoginAttempt as SharedLoginAttempt } from "@vetchium/portal-ui/auth";
import { createPortalAuth } from "@vetchium/portal-ui/auth";
import type { LoginTOTPRequiredResponse } from "typespec/admin/auth/login";
import type {
  AdminLoginChallengeToken,
  AdminSessionToken,
  AuthenticatedSessionResponse,
} from "typespec/admin/auth/types";
import { logout } from "../features/auth/api";
import { clearSessionToken, getSessionToken, setSessionToken } from "./session";

export type LoginAttempt = SharedLoginAttempt;

const auth = createPortalAuth<
  AuthenticatedSessionResponse,
  AdminSessionToken,
  LoginTOTPRequiredResponse,
  LoginTOTPRequiredResponse,
  undefined,
  undefined,
  AdminSessionToken,
  AdminLoginChallengeToken
>({
  sessionExpiredEvent: "vetchium:session-expired",
  readSession: getSessionToken,
  storeSession: (session) => {
    setSessionToken(session.session_token);
    return session.session_token;
  },
  clearSession: clearSessionToken,
  sessionToken: (token) => token,
  preferredLanguage: (session) => session.preferred_language,
  logout: async () => logout(),
  challengeToken: (challenge) => challenge.login_challenge_token,
  pendingChallenge: (challenge) => challenge,
});

export const AuthProvider = auth.AuthProvider;
export const useAuth = auth.useAuth;
