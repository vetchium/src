import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	type AdminLoginRequest,
	type AdminTFARequest,
	validateAdminLoginRequest,
	validateAdminTFARequest,
} from "vetchium-specs/admin/admin-users";
import { getApiBaseUrl } from "../config";
import { setStoredLanguage, type SupportedLanguage } from "../i18n";
import { clearMyInfoCache, primeMyInfoCache } from "../hooks/useMyInfo";
import { ADMIN_UNAUTHORIZED_EVENT } from "../lib/sessionEvents";
import { AuthContext, type AuthState } from "./AuthContext";

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
	const [isInitializing, setIsInitializing] = useState(true);

	// On startup, validate any persisted session against the server before
	// trusting it. A leftover cookie whose session no longer exists (e.g. the
	// server was restarted) must NOT leave the app in a half-authenticated state —
	// we tear it down and return to the login screen.
	useEffect(() => {
		const existingSession = getSessionToken();
		if (!existingSession) {
			setIsInitializing(false);
			return;
		}

		let cancelled = false;
		const validateSession = async () => {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(`${apiBaseUrl}/admin/myinfo`, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${existingSession}`,
					},
				});
				if (cancelled) return;
				if (response.status === 401) {
					// Stale/invalid session: clear it and show the login screen.
					clearSessionToken();
					clearMyInfoCache();
					setSessionTokenState(null);
					setAuthState("login");
				} else {
					// Seed the myinfo cache so the dashboard doesn't refetch it.
					if (response.ok) {
						try {
							primeMyInfoCache(await response.json());
						} catch {
							// Non-JSON body — let consumers fetch myinfo themselves.
						}
					}
					setSessionTokenState(existingSession);
					setAuthState("authenticated");
				}
			} catch {
				// Network error (server unreachable): keep the token optimistically;
				// per-request 401 handling will tear it down once the server responds.
				if (!cancelled) {
					setSessionTokenState(existingSession);
					setAuthState("authenticated");
				}
			} finally {
				if (!cancelled) setIsInitializing(false);
			}
		};

		validateSession();
		return () => {
			cancelled = true;
		};
	}, []);

	// An authenticated request returned 401 mid-session (e.g. server restarted):
	// tear down the client session so the user lands back on the login screen.
	useEffect(() => {
		const handleUnauthorized = () => {
			clearSessionToken();
			clearMyInfoCache();
			setSessionTokenState(null);
			setTfaToken(null);
			setAuthState("login");
		};
		window.addEventListener(ADMIN_UNAUTHORIZED_EVENT, handleUnauthorized);
		return () => {
			window.removeEventListener(ADMIN_UNAUTHORIZED_EVENT, handleUnauthorized);
		};
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
			clearMyInfoCache();
			setSessionTokenState(null);
			setAuthState("login");
			setLoading(false);
			return;
		}

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/admin/logout`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${currentSessionToken}`,
				},
				body: JSON.stringify({}),
			});

			clearSessionToken();
			clearMyInfoCache();
			setSessionTokenState(null);
			setAuthState("login");

			if (!response.ok && response.status !== 401) {
				console.warn("Logout request failed:", response.status);
			}
		} catch (err) {
			console.warn("Logout request error:", err);
			clearSessionToken();
			clearMyInfoCache();
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
				isInitializing,
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
