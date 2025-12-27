/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from "react";
import * as api from "../lib/api-client";
import type { HubSessionToken, Handle } from "vetchium-specs/hub/hub-users";

interface AuthState {
  sessionToken: HubSessionToken | null;
  handle: Handle | null;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  login: (sessionToken: HubSessionToken) => void;
  logout: () => void;
  setAuthData: (sessionToken: HubSessionToken, handle: Handle) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = "vetchium_hub_session";
const HANDLE_KEY = "vetchium_hub_handle";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(() => {
    // Initialize from localStorage
    const sessionToken = localStorage.getItem(STORAGE_KEY);
    const handle = localStorage.getItem(HANDLE_KEY);
    return {
      sessionToken,
      handle,
      isAuthenticated: !!sessionToken,
    };
  });

  useEffect(() => {
    // Sync to localStorage whenever auth state changes
    if (authState.sessionToken) {
      localStorage.setItem(STORAGE_KEY, authState.sessionToken);
      if (authState.handle) {
        localStorage.setItem(HANDLE_KEY, authState.handle);
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(HANDLE_KEY);
    }
  }, [authState]);

  const login = (sessionToken: HubSessionToken) => {
    setAuthState({
      sessionToken,
      handle: authState.handle, // Preserve handle if already set
      isAuthenticated: true,
    });
  };

  const logout = async () => {
    if (authState.sessionToken) {
      try {
        await api.logout(authState.sessionToken);
      } catch (error) {
        // Log error but still clear local state
        console.error("Logout error:", error);
      }
    }
    setAuthState({
      sessionToken: null,
      handle: null,
      isAuthenticated: false,
    });
  };

  const setAuthData = (sessionToken: HubSessionToken, handle: Handle) => {
    setAuthState({
      sessionToken,
      handle,
      isAuthenticated: true,
    });
  };

  return (
    <AuthContext.Provider
      value={{ ...authState, login, logout, setAuthData }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
