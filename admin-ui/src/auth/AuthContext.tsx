import { useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LoginTOTPRequiredResponse } from "../../../typespec/admin/auth/login.ts";
import type {
  AdminLoginChallengeToken,
  AdminSessionToken,
  AuthenticatedSessionResponse,
} from "../../../typespec/admin/auth/types.ts";
import { usePendingOperations } from "../app/PendingOperationContext";
import { usePreferences } from "../app/PreferencesContext";
import { logout as logoutRequest } from "../features/auth/api";
import { clearSessionToken, getSessionToken, setSessionToken } from "./session";

/** Identifies one sign-in attempt for as long as the tab lives. */
export type LoginAttempt = number;

export interface LoginAttemptOwner {
  attempt?: LoginAttempt;
  challenge?: AdminLoginChallengeToken;
}

interface AuthContextValue {
  authenticated: boolean;
  /** The session a caller is acting on behalf of, to hand back later. */
  sessionToken: AdminSessionToken | null;
  pendingChallenge: LoginTOTPRequiredResponse | null;
  clearChallenge: () => void;
  /**
   * Claims ownership of a sign-in attempt. A response belonging to an attempt
   * that has since been superseded is discarded rather than allowed to
   * overwrite the session, challenge or destination of the attempt that
   * replaced it — including when the two attempts are for different accounts.
   */
  beginAttempt: () => LoginAttempt;
  /** Records the challenge, unless its attempt has already been superseded. */
  beginChallenge: (
    challenge: LoginTOTPRequiredResponse,
    forAttempt: LoginAttempt,
  ) => boolean;
  /** Adopts the session, unless its owner has been superseded. */
  completeAuthentication: (
    session: AuthenticatedSessionResponse,
    owner?: LoginAttemptOwner,
  ) => boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const preferences = usePreferences();
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const [token, setToken] = useState(getSessionToken);
  const [pendingChallenge, setPendingChallenge] =
    useState<LoginTOTPRequiredResponse | null>(null);
  // Read by callbacks an unmounted page may still be holding, so these have to
  // be the live values rather than the ones captured when that page last
  // rendered. The challenge token and the attempt that owns it live in one ref
  // so they always change together: held apart, the token would still be the
  // previous attempt's during the render that adopts the new one.
  const tokenRef = useRef(token);
  const attemptRef = useRef<LoginAttempt>(0);
  const challengeOwnerRef = useRef<{
    token: AdminLoginChallengeToken;
    attempt: LoginAttempt;
  } | null>(null);

  useEffect(() => {
    const handleExpiry = () => {
      tokenRef.current = null;
      setToken(null);
      queryClient.clear();
    };
    window.addEventListener("vetchium:session-expired", handleExpiry);
    return () =>
      window.removeEventListener("vetchium:session-expired", handleExpiry);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authenticated: token !== null,
      sessionToken: token,
      pendingChallenge,
      beginAttempt: () => {
        attemptRef.current += 1;
        // A new sign in retires any challenge the previous one published.
        // Leaving it addressable would let browser history return to the
        // verification step and spend a code on a challenge whose result this
        // client is now bound to reject.
        challengeOwnerRef.current = null;
        setPendingChallenge(null);
        return attemptRef.current;
      },
      beginChallenge: (challenge, forAttempt) => {
        if (forAttempt !== attemptRef.current) {
          return false;
        }
        challengeOwnerRef.current = {
          token: challenge.login_challenge_token,
          attempt: forAttempt,
        };
        setPendingChallenge(challenge);
        return true;
      },
      clearChallenge: () => {
        // Abandoning the challenge supersedes its attempt, so a verification
        // still in flight for it cannot come back and claim the portal.
        attemptRef.current += 1;
        challengeOwnerRef.current = null;
        setPendingChallenge(null);
      },
      completeAuthentication: (session, owner) => {
        if (
          owner?.attempt !== undefined &&
          owner.attempt !== attemptRef.current
        ) {
          return false;
        }
        if (owner?.challenge !== undefined) {
          const current = challengeOwnerRef.current;
          if (
            current === null ||
            current.token !== owner.challenge ||
            current.attempt !== attemptRef.current
          ) {
            return false;
          }
        }
        // Anything cached belongs to whoever held the portal before this
        // session, including their identity and permissions.
        queryClient.clear();
        setSessionToken(session.session_token);
        preferences.setLanguage(session.preferred_language);
        tokenRef.current = session.session_token;
        setToken(session.session_token);
        challengeOwnerRef.current = null;
        setPendingChallenge(null);
        return true;
      },
      logout: async () => {
        // Signing out holds for its own duration, so the exclusion runs both
        // ways: an operation cannot be started underneath a sign-out that has
        // already begun, just as a sign-out cannot begin under an operation.
        const release = hold();
        // The request needs the session, so the teardown cannot precede it.
        // Scoped to that session, because two overlapping sign-outs must not
        // let the slower one tear down whoever signed in after the first.
        const session = tokenRef.current;
        try {
          await logoutRequest();
        } finally {
          release();
          if (tokenRef.current === session) {
            clearSessionToken();
            queryClient.clear();
            tokenRef.current = null;
            setToken(null);
            attemptRef.current += 1;
            challengeOwnerRef.current = null;
            setPendingChallenge(null);
          }
        }
      },
    }),
    [hold, pendingChallenge, preferences, queryClient, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("AuthProvider is missing");
  }
  return value;
}
