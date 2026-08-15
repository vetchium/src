import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { LoginTOTPRequiredResponse } from "../../../typespec/admin/auth/login.ts";
import type { AuthenticatedSessionResponse } from "../../../typespec/admin/auth/types.ts";
import { usePreferences } from "../app/PreferencesContext";
import { logout as logoutRequest } from "../features/auth/api";
import { clearSessionToken, getSessionToken, setSessionToken } from "./session";

interface AuthContextValue {
  authenticated: boolean;
  pendingChallenge: LoginTOTPRequiredResponse | null;
  beginChallenge: (challenge: LoginTOTPRequiredResponse) => void;
  clearChallenge: () => void;
  completeAuthentication: (session: AuthenticatedSessionResponse) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const preferences = usePreferences();
  const [token, setToken] = useState(getSessionToken);
  const [pendingChallenge, setPendingChallenge] =
    useState<LoginTOTPRequiredResponse | null>(null);

  useEffect(() => {
    const handleExpiry = () => setToken(null);
    window.addEventListener("vetchium:session-expired", handleExpiry);
    return () =>
      window.removeEventListener("vetchium:session-expired", handleExpiry);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      authenticated: token !== null,
      pendingChallenge,
      beginChallenge: setPendingChallenge,
      clearChallenge: () => setPendingChallenge(null),
      completeAuthentication: (session) => {
        setSessionToken(session.session_token);
        preferences.setLanguage(session.preferred_language);
        setToken(session.session_token);
        setPendingChallenge(null);
      },
      logout: async () => {
        try {
          await logoutRequest();
        } finally {
          clearSessionToken();
          setToken(null);
          setPendingChallenge(null);
        }
      },
    }),
    [pendingChallenge, preferences, token],
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
