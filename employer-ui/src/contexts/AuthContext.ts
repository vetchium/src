import { createContext } from "react";

export type AuthState = "login" | "tfa" | "authenticated";

export interface AuthContextType {
	authState: AuthState;
	loading: boolean;
	error: string | null;
	sessionToken: string | null;
	login: (email: string, domain: string, password: string) => Promise<void>;
	verifyTFA: (tfaCode: string, rememberMe: boolean) => Promise<void>;
	logout: () => Promise<void>;
	backToLogin: () => void;
	clearError: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(
	undefined
);
