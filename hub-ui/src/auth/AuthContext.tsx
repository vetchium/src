import type { PropsWithChildren } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import type { AuthenticatedSessionResponse } from "../../../typespec/hub/auth/types.ts";
import { hubAPI } from "../api/hub";
import {
  clearSession,
  readSession,
  type StoredSession,
  storeSession,
} from "./session";

interface AuthContextValue {
  authenticated: boolean;
  session: StoredSession | null;
  signIn: (session: AuthenticatedSessionResponse, remembered: boolean) => void;
  signOut: () => Promise<void>;
  updateSession: (updates: Partial<AuthenticatedSessionResponse>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState(readSession);
  const value = useMemo<AuthContextValue>(
    () => ({
      authenticated: session !== null,
      session,
      signIn: (nextSession, remembered) => {
        setSession(storeSession(nextSession, remembered));
      },
      signOut: async () => {
        const token = session?.session_token;
        clearSession();
        setSession(null);
        if (token) {
          try {
            await hubAPI.logout(token);
          } catch {
            // Local sign-out must succeed even when the server is unavailable.
          }
        }
      },
      updateSession: (updates) => {
        setSession((current) =>
          current === null
            ? null
            : storeSession({ ...current, ...updates }, current.remembered),
        );
      },
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("AuthProvider is missing");
  return value;
}
