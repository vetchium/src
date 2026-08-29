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
import type { FrontendLocale } from "typespec/common/localization";
import { usePendingOperations } from "./pending-operations";
import { usePreferences } from "./preferences";

export type LoginAttempt = number;

export interface LoginAttemptOwner<ChallengeToken extends string> {
  attempt?: LoginAttempt;
  challenge?: ChallengeToken;
}

export interface PortalAuthConfiguration<
  SessionResponse,
  StoredSession,
  Challenge,
  PendingChallenge,
  SessionMetadata,
  ChallengeMetadata,
  SessionToken extends string,
  ChallengeToken extends string,
> {
  sessionExpiredEvent: string;
  readSession: () => StoredSession | null;
  storeSession: (
    session: SessionResponse,
    metadata: SessionMetadata,
  ) => StoredSession;
  clearSession: () => void;
  sessionToken: (session: StoredSession) => SessionToken;
  preferredLanguage: (session: SessionResponse) => FrontendLocale;
  logout: (session: StoredSession) => Promise<void>;
  ignoreLogoutFailure?: boolean;
  challengeToken: (challenge: Challenge) => ChallengeToken;
  pendingChallenge: (
    challenge: Challenge,
    metadata: ChallengeMetadata,
  ) => PendingChallenge;
  updateSession?: (
    session: StoredSession,
    updates: Partial<SessionResponse>,
  ) => StoredSession;
}

export interface PortalAuthValue<
  SessionResponse,
  StoredSession,
  Challenge,
  PendingChallenge,
  SessionMetadata,
  ChallengeMetadata,
  SessionToken extends string,
  ChallengeToken extends string,
> {
  authenticated: boolean;
  session: StoredSession | null;
  sessionToken: SessionToken | null;
  pendingChallenge: PendingChallenge | null;
  beginAttempt: () => LoginAttempt;
  beginChallenge: (
    challenge: Challenge,
    metadata: ChallengeMetadata,
    forAttempt: LoginAttempt,
  ) => boolean;
  clearChallenge: () => void;
  completeAuthentication: (
    session: SessionResponse,
    metadata: SessionMetadata,
    owner?: LoginAttemptOwner<ChallengeToken>,
  ) => boolean;
  signOut: () => Promise<void>;
  updateSession: (updates: Partial<SessionResponse>) => void;
}

/**
 * Creates a portal's typed authentication context around its storage and API
 * adapters. Attempt ownership prevents late responses from replacing a newer
 * sign-in, even when the attempts belong to different accounts.
 */
export function createPortalAuth<
  SessionResponse,
  StoredSession,
  Challenge,
  PendingChallenge,
  SessionMetadata,
  ChallengeMetadata,
  SessionToken extends string,
  ChallengeToken extends string,
>(
  config: PortalAuthConfiguration<
    SessionResponse,
    StoredSession,
    Challenge,
    PendingChallenge,
    SessionMetadata,
    ChallengeMetadata,
    SessionToken,
    ChallengeToken
  >,
) {
  type Value = PortalAuthValue<
    SessionResponse,
    StoredSession,
    Challenge,
    PendingChallenge,
    SessionMetadata,
    ChallengeMetadata,
    SessionToken,
    ChallengeToken
  >;
  const AuthContext = createContext<Value | null>(null);

  function AuthProvider({ children }: PropsWithChildren) {
    const preferences = usePreferences();
    const queryClient = useQueryClient();
    const { hold } = usePendingOperations();
    const [session, setSession] = useState(config.readSession);
    const [pendingChallenge, setPendingChallenge] =
      useState<PendingChallenge | null>(null);
    const sessionRef = useRef(session);
    const attemptRef = useRef<LoginAttempt>(0);
    const challengeOwnerRef = useRef<{
      token: ChallengeToken;
      attempt: LoginAttempt;
    } | null>(null);

    useEffect(() => {
      const handleExpiry = () => {
        sessionRef.current = null;
        setSession(null);
        queryClient.clear();
      };
      window.addEventListener(config.sessionExpiredEvent, handleExpiry);
      return () =>
        window.removeEventListener(config.sessionExpiredEvent, handleExpiry);
    }, [queryClient]);

    const value = useMemo<Value>(
      () => ({
        authenticated: session !== null,
        session,
        sessionToken: session === null ? null : config.sessionToken(session),
        pendingChallenge,
        beginAttempt: () => {
          attemptRef.current += 1;
          challengeOwnerRef.current = null;
          setPendingChallenge(null);
          return attemptRef.current;
        },
        beginChallenge: (challenge, metadata, forAttempt) => {
          if (forAttempt !== attemptRef.current) return false;
          challengeOwnerRef.current = {
            token: config.challengeToken(challenge),
            attempt: forAttempt,
          };
          setPendingChallenge(config.pendingChallenge(challenge, metadata));
          return true;
        },
        clearChallenge: () => {
          attemptRef.current += 1;
          challengeOwnerRef.current = null;
          setPendingChallenge(null);
        },
        completeAuthentication: (next, metadata, owner) => {
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
          const stored = config.storeSession(next, metadata);
          preferences.setLanguage(config.preferredLanguage(next));
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
            if (signingOut !== null) await config.logout(signingOut);
          } catch (error) {
            if (config.ignoreLogoutFailure !== true) throw error;
          } finally {
            release();
            if (
              sessionRef.current !== null &&
              signingOut !== null &&
              config.sessionToken(sessionRef.current) ===
                config.sessionToken(signingOut)
            ) {
              config.clearSession();
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
          if (current === null || config.updateSession === undefined) return;
          const stored = config.updateSession(current, updates);
          sessionRef.current = stored;
          setSession(stored);
        },
      }),
      [hold, pendingChallenge, preferences, queryClient, session],
    );

    return (
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
  }

  function useAuth(): Value {
    const value = useContext(AuthContext);
    if (value === null) throw new Error("AuthProvider is missing");
    return value;
  }

  return { AuthProvider, useAuth };
}
