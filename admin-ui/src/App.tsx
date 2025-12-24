import { useState, useEffect } from "react";
import {
	ConfigProvider,
	Layout,
	Card,
	Form,
	Input,
	Button,
	Typography,
	Alert,
	Space,
} from "antd";
import { UserOutlined, LockOutlined, SafetyOutlined } from "@ant-design/icons";
import {
	type AdminLoginRequest,
	type AdminLoginResponse,
	type AdminTFARequest,
	type AdminTFAResponse,
	type AdminLogoutRequest,
	validateAdminLoginRequest,
	validateAdminTFARequest,
	TFA_CODE_LENGTH,
} from "vetchium-specs/admin/admin-users";
import {
	EMAIL_MIN_LENGTH,
	EMAIL_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	PASSWORD_MAX_LENGTH,
} from "vetchium-specs/common/common";
import { getApiBaseUrl } from "./config";

const { Content } = Layout;
const { Title, Text } = Typography;

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
	// Set cookie with secure flags - expires in 24 hours
	const expires = new Date();
	expires.setTime(expires.getTime() + 24 * 60 * 60 * 1000);
	document.cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; expires=${expires.toUTCString()}; path=/; SameSite=Strict`;
}

function clearSessionToken(): void {
	document.cookie = `${SESSION_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`;
}

type AuthState = "login" | "tfa" | "authenticated";

function App() {
	const [authState, setAuthState] = useState<AuthState>("login");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [tfaToken, setTfaToken] = useState<string | null>(null);

	// Check for existing session on mount
	useEffect(() => {
		const existingSession = getSessionToken();
		if (existingSession) {
			setAuthState("authenticated");
		}
	}, []);

	const handleLogin = async (values: { email: string; password: string }) => {
		setLoading(true);
		setError(null);

		const loginRequest: AdminLoginRequest = {
			email: values.email,
			password: values.password,
		};

		const validationErrors = validateAdminLoginRequest(loginRequest);
		if (validationErrors.length > 0) {
			setError(
				validationErrors.map((e) => `${e.field}: ${e.message}`).join(", ")
			);
			setLoading(false);
			return;
		}

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/admin/login`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(loginRequest),
			});

			if (response.status === 400) {
				const errors: unknown = await response.json();
				if (Array.isArray(errors)) {
					setError(
						errors
							.map((e: { field: string; message: string }) => {
								const field = String(e.field ?? "");
								const message = String(e.message ?? "");
								return `${field}: ${message}`;
							})
							.join(", ")
					);
				} else {
					setError("Invalid request");
				}
				return;
			}

			if (response.status === 401) {
				setError("Invalid credentials");
				return;
			}

			if (response.status === 422) {
				setError("Account is not in a valid state to login");
				return;
			}

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data: AdminLoginResponse = await response.json();
			setTfaToken(data.tfa_token);
			setAuthState("tfa");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Login failed");
		} finally {
			setLoading(false);
		}
	};

	const handleTFA = async (values: { tfa_code: string }) => {
		if (!tfaToken) {
			setError("TFA token missing. Please login again.");
			setAuthState("login");
			return;
		}

		setLoading(true);
		setError(null);

		const tfaRequest: AdminTFARequest = {
			tfa_token: tfaToken,
			tfa_code: values.tfa_code,
		};

		const validationErrors = validateAdminTFARequest(tfaRequest);
		if (validationErrors.length > 0) {
			setError(
				validationErrors.map((e) => `${e.field}: ${e.message}`).join(", ")
			);
			setLoading(false);
			return;
		}

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/admin/tfa`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(tfaRequest),
			});

			if (response.status === 400) {
				const errors: unknown = await response.json();
				if (Array.isArray(errors)) {
					setError(
						errors
							.map((e: { field: string; message: string }) => {
								const field = String(e.field ?? "");
								const message = String(e.message ?? "");
								return `${field}: ${message}`;
							})
							.join(", ")
					);
				} else {
					setError("Invalid request");
				}
				return;
			}

			if (response.status === 401) {
				setError("TFA token expired or invalid. Please login again.");
				setAuthState("login");
				setTfaToken(null);
				return;
			}

			if (response.status === 403) {
				setError("Invalid TFA code. Please try again.");
				return;
			}

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data: AdminTFAResponse = await response.json();
			setSessionToken(data.session_token);
			setTfaToken(null);
			setAuthState("authenticated");
		} catch (err) {
			setError(err instanceof Error ? err.message : "TFA verification failed");
		} finally {
			setLoading(false);
		}
	};

	const handleLogout = async () => {
		setLoading(true);
		setError(null);

		const sessionToken = getSessionToken();
		if (!sessionToken) {
			clearSessionToken();
			setAuthState("login");
			setLoading(false);
			return;
		}

		const logoutRequest: AdminLogoutRequest = {
			session_token: sessionToken,
		};

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/admin/logout`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(logoutRequest),
			});

			// Clear session regardless of response - even if logout fails server-side,
			// we should clear local state
			clearSessionToken();
			setAuthState("login");

			if (!response.ok && response.status !== 401) {
				console.warn("Logout request failed:", response.status);
			}
		} catch (err) {
			console.warn("Logout request error:", err);
			// Still clear session on error
			clearSessionToken();
			setAuthState("login");
		} finally {
			setLoading(false);
		}
	};

	const handleBackToLogin = () => {
		setTfaToken(null);
		setError(null);
		setAuthState("login");
	};

	const renderLoginForm = () => (
		<Card style={{ width: 400 }}>
			<Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
				Vetchium Admin
			</Title>

			<Form
				name="login"
				onFinish={handleLogin}
				layout="vertical"
				requiredMark={false}
			>
				{error && (
					<Alert
						message={error}
						type="error"
						showIcon
						style={{ marginBottom: 16 }}
					/>
				)}

				<Form.Item
					name="email"
					validateFirst
					rules={[
						{ required: true, message: "Please enter your email" },
						{ type: "email", message: "Please enter a valid email" },
						{
							min: EMAIL_MIN_LENGTH,
							message: `Email must be at least ${EMAIL_MIN_LENGTH} characters`,
						},
						{
							max: EMAIL_MAX_LENGTH,
							message: `Email must be at most ${EMAIL_MAX_LENGTH} characters`,
						},
					]}
				>
					<Input prefix={<UserOutlined />} placeholder="Email" size="large" />
				</Form.Item>

				<Form.Item
					name="password"
					validateFirst
					rules={[
						{ required: true, message: "Please enter your password" },
						{
							min: PASSWORD_MIN_LENGTH,
							message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
						},
						{
							max: PASSWORD_MAX_LENGTH,
							message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
						},
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder="Password"
						size="large"
					/>
				</Form.Item>

				<Form.Item>
					<Button
						type="primary"
						htmlType="submit"
						loading={loading}
						block
						size="large"
					>
						Login
					</Button>
				</Form.Item>
			</Form>
		</Card>
	);

	const renderTFAForm = () => (
		<Card style={{ width: 400 }}>
			<Title level={3} style={{ textAlign: "center", marginBottom: 8 }}>
				Two-Factor Authentication
			</Title>
			<Text
				type="secondary"
				style={{ display: "block", textAlign: "center", marginBottom: 24 }}
			>
				A 6-digit code has been sent to your email
			</Text>

			<Form
				name="tfa"
				onFinish={handleTFA}
				layout="vertical"
				requiredMark={false}
			>
				{error && (
					<Alert
						message={error}
						type="error"
						showIcon
						style={{ marginBottom: 16 }}
					/>
				)}

				<Form.Item
					name="tfa_code"
					validateFirst
					rules={[
						{ required: true, message: "Please enter the TFA code" },
						{
							len: TFA_CODE_LENGTH,
							message: `Code must be exactly ${TFA_CODE_LENGTH} digits`,
						},
						{
							pattern: /^[0-9]+$/,
							message: "Code must contain only digits",
						},
					]}
				>
					<Input
						prefix={<SafetyOutlined />}
						placeholder="Enter 6-digit code"
						size="large"
						maxLength={TFA_CODE_LENGTH}
					/>
				</Form.Item>

				<Form.Item>
					<Space direction="vertical" style={{ width: "100%" }}>
						<Button
							type="primary"
							htmlType="submit"
							loading={loading}
							block
							size="large"
						>
							Verify
						</Button>
						<Button
							type="link"
							onClick={handleBackToLogin}
							block
							disabled={loading}
						>
							Back to Login
						</Button>
					</Space>
				</Form.Item>
			</Form>
		</Card>
	);

	const renderDashboard = () => (
		<Card style={{ width: 600 }}>
			<Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
				Welcome, Admin
			</Title>

			<Text
				type="secondary"
				style={{ display: "block", textAlign: "center", marginBottom: 24 }}
			>
				You are successfully logged in to the Vetchium Admin Portal.
			</Text>

			<Button
				type="primary"
				danger
				onClick={handleLogout}
				loading={loading}
				block
				size="large"
			>
				Logout
			</Button>
		</Card>
	);

	return (
		<ConfigProvider
			theme={{
				token: {
					colorPrimary: "#1890ff",
				},
			}}
		>
			<Layout style={{ minHeight: "100vh" }}>
				<Content
					style={{
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
					}}
				>
					{authState === "login" && renderLoginForm()}
					{authState === "tfa" && renderTFAForm()}
					{authState === "authenticated" && renderDashboard()}
				</Content>
			</Layout>
		</ConfigProvider>
	);
}

export default App;
