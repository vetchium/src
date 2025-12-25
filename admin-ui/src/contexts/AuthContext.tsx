import {
	createContext,
	useContext,
	useState,
	useEffect,
	useCallback,
	type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
	type AdminLoginRequest,
	type AdminTFARequest,
	type AdminLogoutRequest,
	validateAdminLoginRequest,
	validateAdminTFARequest,
} from "vetchium-specs/admin/admin-users";
import { getApiBaseUrl } from "../config";
import { setStoredLanguage, type SupportedLanguage } from "../i18n";

const SESSION_COOKIE_NAME = "vetchium_admin_session";

function getSessionToken(): string | null {
	const cookies = document.cookie.split(";");
	for (const cookie of cookies) {
		const parts = cookie.trim().split("=");
		const name = parts[0];
		const value = parts.slice(1).join("=");
		if (name === SESSION_COOKIE_NAME && value) {
			return decodeURIComponent(value);
		}
	}
	return null;
}

function setSessionToken(token: string): void {
	const expires = new Date();
	expires.setTime(expires.getTime() + 24 * 60 * 60 * 1000);
	document.cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; expires=${expires.toUTCString()}; path=/; SameSite=Strict`;
}

function clearSessionToken(): void {
	document.cookie = `${SESSION_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`;
}

export type AuthState = "login" | "tfa" | "authenticated";

interface AuthContextType {
	authState: AuthState;
	loading: boolean;
	error: string | null;
	sessionToken: string | null;
	login: (email: string, password: string) => Promise<void>;
	verifyTFA: (tfaCode: string) => Promise<void>;
	logout: () => Promise<void>;
	backToLogin: () => void;
	clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
	children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
	const { t, i18n } = useTranslation("auth");
	const [authState, setAuthState] = useState<AuthState>("login");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [tfaToken, setTfaToken] = useState<string | null>(null);
	const [sessionToken, setSessionTokenState] = useState<string | null>(null);

	useEffect(() => {
		const existingSession = getSessionToken();
		if (existingSession) {
			setSessionTokenState(existingSession);
			setAuthState("authenticated");
		}
	}, []);

	const formatValidationErrors = (
		errors: Array<{ field: string; message: string }>
	): string => {
		return errors.map((e) => `${e.field}: ${e.message}`).join(", ");
	};

	const login = useCallback(
		async (email: string, password: string) => {
			setLoading(true);
			setError(null);

			const loginRequest: AdminLoginRequest = { email, password };
			const validationErrors = validateAdminLoginRequest(loginRequest);
			if (validationErrors.length > 0) {
				setError(formatValidationErrors(validationErrors));
				setLoading(false);
				return;
			}

			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(`${apiBaseUrl}/admin/login`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(loginRequest),
				});

				if (response.status === 400) {
					const errors: unknown = await response.json();
					if (Array.isArray(errors)) {
						setError(
							formatValidationErrors(
								errors.map((e: { field: string; message: string }) => ({
									field: String(e.field ?? ""),
									message: String(e.message ?? ""),
								}))
							)
						);
					} else {
						setError(t("errors.invalidRequest"));
					}
					return;
				}

				if (response.status === 401) {
					setError(t("login.invalidCredentials"));
					return;
				}

				if (response.status === 422) {
					setError(t("login.accountInvalidState"));
					return;
				}

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data = await response.json();
				setTfaToken(data.tfa_token);
				setAuthState("tfa");
			} catch (err) {
				setError(err instanceof Error ? err.message : t("login.failed"));
			} finally {
				setLoading(false);
			}
		},
		[t]
	);

	const verifyTFA = useCallback(
		async (tfaCode: string) => {
			if (!tfaToken) {
				setError(t("tfa.tokenMissing"));
				setAuthState("login");
				return;
			}

			setLoading(true);
			setError(null);

			const tfaRequest: AdminTFARequest = {
				tfa_token: tfaToken,
				tfa_code: tfaCode,
			};

			const validationErrors = validateAdminTFARequest(tfaRequest);
			if (validationErrors.length > 0) {
				setError(formatValidationErrors(validationErrors));
				setLoading(false);
				return;
			}

			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(`${apiBaseUrl}/admin/tfa`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(tfaRequest),
				});

				if (response.status === 400) {
					const errors: unknown = await response.json();
					if (Array.isArray(errors)) {
						setError(
							formatValidationErrors(
								errors.map((e: { field: string; message: string }) => ({
									field: String(e.field ?? ""),
									message: String(e.message ?? ""),
								}))
							)
						);
					} else {
						setError(t("errors.invalidRequest"));
					}
					return;
				}

				if (response.status === 401) {
					setError(t("tfa.tokenExpired"));
					setAuthState("login");
					setTfaToken(null);
					return;
				}

				if (response.status === 403) {
					setError(t("tfa.invalidCode"));
					return;
				}

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data = await response.json();
				setSessionToken(data.session_token);
				setSessionTokenState(data.session_token);
				setTfaToken(null);
				setAuthState("authenticated");

				// Update language from server preference
				if (data.preferred_language) {
					const serverLang = data.preferred_language as SupportedLanguage;
					setStoredLanguage(serverLang);
					i18n.changeLanguage(serverLang);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : t("tfa.failed"));
			} finally {
				setLoading(false);
			}
		},
		[tfaToken, t, i18n]
	);

	const logout = useCallback(async () => {
		setLoading(true);
		setError(null);

		const currentSessionToken = getSessionToken();
		if (!currentSessionToken) {
			clearSessionToken();
			setSessionTokenState(null);
			setAuthState("login");
			setLoading(false);
			return;
		}

		const logoutRequest: AdminLogoutRequest = {
			session_token: currentSessionToken,
		};

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/admin/logout`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(logoutRequest),
			});

			clearSessionToken();
			setSessionTokenState(null);
			setAuthState("login");

			if (!response.ok && response.status !== 401) {
				console.warn("Logout request failed:", response.status);
			}
		} catch (err) {
			console.warn("Logout request error:", err);
			clearSessionToken();
			setSessionTokenState(null);
			setAuthState("login");
		} finally {
			setLoading(false);
		}
	}, []);

	const backToLogin = useCallback(() => {
		setTfaToken(null);
		setError(null);
		setAuthState("login");
	}, []);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	return (
		<AuthContext.Provider
			value={{
				authState,
				loading,
				error,
				sessionToken,
				login,
				verifyTFA,
				logout,
				backToLogin,
				clearError,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth(): AuthContextType {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
