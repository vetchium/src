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
import type { LoginTOTPRequiredResponse } from "../../../typespec/hub/auth/login.ts";
import type {
  AuthenticatedSessionResponse,
  HubLoginChallengeToken,
} from "../../../typespec/hub/auth/types.ts";
import { hubAPI } from "../api/hub";
import { usePendingOperations } from "../app/PendingOperationContext";
import { usePreferences } from "../app/PreferencesContext";
import {
  clearSession,
  readSession,
  type StoredSession,
  storeSession,
} from "./session";

type LoginAttempt = number;

interface PendingChallenge extends LoginTOTPRequiredResponse {
  remembered: boolean;
}

interface LoginAttemptOwner {
  attempt?: LoginAttempt;
  challenge?: HubLoginChallengeToken;
}

interface AuthContextValue {
  authenticated: boolean;
  session: StoredSession | null;
  pendingChallenge: PendingChallenge | null;
  beginAttempt: () => LoginAttempt;
  beginChallenge: (
    challenge: LoginTOTPRequiredResponse,
    remembered: boolean,
    forAttempt: LoginAttempt,
  ) => boolean;
  clearChallenge: () => void;
  completeAuthentication: (
    session: AuthenticatedSessionResponse,
    remembered: boolean,
    owner?: LoginAttemptOwner,
  ) => boolean;
  signOut: () => Promise<void>;
  updateSession: (updates: Partial<AuthenticatedSessionResponse>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const preferences = usePreferences();
  const queryClient = useQueryClient();
  const { hold } = usePendingOperations();
  const [session, setSession] = useState(readSession);
  const [pendingChallenge, setPendingChallenge] =
    useState<PendingChallenge | null>(null);
  const sessionRef = useRef(session);
  const attemptRef = useRef<LoginAttempt>(0);
  const challengeOwnerRef = useRef<{
    token: HubLoginChallengeToken;
    attempt: LoginAttempt;
  } | null>(null);

  useEffect(() => {
    const handleExpiry = () => {
      sessionRef.current = null;
      setSession(null);
      queryClient.clear();
    };
    window.addEventListener("vetchium:hub-session-expired", handleExpiry);
    return () =>
      window.removeEventListener("vetchium:hub-session-expired", handleExpiry);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authenticated: session !== null,
      session,
      pendingChallenge,
      beginAttempt: () => {
        attemptRef.current += 1;
        challengeOwnerRef.current = null;
        setPendingChallenge(null);
        return attemptRef.current;
      },
      beginChallenge: (challenge, remembered, forAttempt) => {
        if (forAttempt !== attemptRef.current) return false;
        challengeOwnerRef.current = {
          token: challenge.login_challenge_token,
          attempt: forAttempt,
        };
        setPendingChallenge({ ...challenge, remembered });
        return true;
      },
      clearChallenge: () => {
        attemptRef.current += 1;
        challengeOwnerRef.current = null;
        setPendingChallenge(null);
      },
      completeAuthentication: (next, remembered, owner) => {
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
        queryClient.clear();
        const stored = storeSession(next, remembered);
        preferences.setLanguage(next.preferred_language);
        sessionRef.current = stored;
        setSession(stored);
        challengeOwnerRef.current = null;
        setPendingChallenge(null);
        return true;
      },
      signOut: async () => {
        const release = hold();
        const signingOut = sessionRef.current;
        try {
          if (signingOut !== null) {
            await hubAPI.logout(signingOut.session_token);
          }
        } catch {
          // Local sign-out remains available when the API cannot be reached.
        } finally {
          release();
          if (sessionRef.current?.session_token === signingOut?.session_token) {
            clearSession();
            queryClient.clear();
            sessionRef.current = null;
            setSession(null);
            attemptRef.current += 1;
            challengeOwnerRef.current = null;
            setPendingChallenge(null);
          }
        }
      },
      updateSession: (updates) => {
        const current = sessionRef.current;
        if (current === null) return;
        const stored = storeSession(
          { ...current, ...updates },
          current.remembered,
        );
        sessionRef.current = stored;
        setSession(stored);
      },
    }),
    [hold, pendingChallenge, preferences, queryClient, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("AuthProvider is missing");
  return value;
}
