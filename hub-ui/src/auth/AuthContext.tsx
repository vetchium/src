import type { PropsWithChildren } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { clearSessionToken, readSessionToken } from "./session";

interface AuthContextValue {
  authenticated: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [sessionToken, setSessionToken] = useState(readSessionToken);
  const value = useMemo<AuthContextValue>(
    () => ({
      authenticated: sessionToken !== null,
      logout: () => {
        clearSessionToken();
        setSessionToken(null);
      },
    }),
    [sessionToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("AuthProvider is missing");
  return value;
}
