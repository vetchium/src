import { Form, Input, Button, Alert, Spin } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { getApiBaseUrl } from "../config";
import {
	PASSWORD_MIN_LENGTH,
	PASSWORD_MAX_LENGTH,
} from "vetchium-specs/common/common";
import type { OrgCompleteSignupRequest } from "vetchium-specs/org/org-users";

interface SignupCompleteFormValues {
	password: string;
	confirmPassword: string;
}

const SESSION_COOKIE_NAME = "vetchium_employer_session";

function setSessionToken(token: string): void {
	const expires = new Date();
	expires.setTime(expires.getTime() + 24 * 60 * 60 * 1000);
	document.cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; expires=${expires.toUTCString()}; path=/; SameSite=Strict`;
}

export function SignupCompleteForm() {
	const { t } = useTranslation("auth");
	const [form] = Form.useForm<SignupCompleteFormValues>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();

	const token = searchParams.get("token");

	useEffect(() => {
		if (!token) {
			setError(t("signupComplete.missingToken"));
		}
	}, [token, t]);

	const handleSubmit = async (values: SignupCompleteFormValues) => {
		if (!token) {
			setError(t("signupComplete.missingToken"));
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: OrgCompleteSignupRequest = {
				signup_token: token,
				password: values.password,
			};

			const response = await fetch(`${apiBaseUrl}/org/complete-signup`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
			});

			if (response.status === 201) {
				const data = await response.json();
				setSessionToken(data.session_token);
				// Reload to trigger auth state update
				window.location.href = "/";
				return;
			}

			if (response.status === 400) {
				const errors = await response.json();
				if (Array.isArray(errors)) {
					const errorMessages = errors
						.map(
							(e: { field: string; message: string }) =>
								`${e.field}: ${e.message}`
						)
						.join(", ");
					setError(errorMessages);
				} else {
					setError(t("errors.invalidRequest"));
				}
				return;
			}

			if (response.status === 401) {
				setError(t("signupComplete.tokenExpired"));
				return;
			}

			if (response.status === 409) {
				setError(t("signupComplete.emailAlreadyRegistered"));
				return;
			}

			if (response.status === 422) {
				setError(t("signupComplete.dnsNotVerified"));
				return;
			}

			setError(t("signupComplete.failed"));
		} catch (err) {
			if (err instanceof Error && err.message === "Failed to fetch") {
				setError(t("signupComplete.networkError"));
			} else {
				setError(
					err instanceof Error ? err.message : t("signupComplete.failed")
				);
			}
		} finally {
			setLoading(false);
		}
	};

	const clearError = () => setError(null);

	return (
		<Spin spinning={loading}>
			<Form
				form={form}
				name="signupComplete"
				onFinish={handleSubmit}
				layout="vertical"
				requiredMark={false}
			>
				{error && (
					<Alert
						type="error"
						description={error}
						closable={{ afterClose: clearError }}
						style={{ marginBottom: 16 }}
					/>
				)}

				<Form.Item
					name="password"
					rules={[
						{ required: true, message: t("signupComplete.passwordRequired") },
						{
							min: PASSWORD_MIN_LENGTH,
							message: t("signupComplete.passwordMinLength", {
								min: PASSWORD_MIN_LENGTH,
							}),
						},
						{
							max: PASSWORD_MAX_LENGTH,
							message: t("signupComplete.passwordMaxLength", {
								max: PASSWORD_MAX_LENGTH,
							}),
						},
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("signupComplete.password")}
						size="large"
						autoComplete="new-password"
					/>
				</Form.Item>

				<Form.Item
					name="confirmPassword"
					dependencies={["password"]}
					rules={[
						{
							required: true,
							message: t("signupComplete.confirmPasswordRequired"),
						},
						({ getFieldValue }) => ({
							validator(_, value) {
								if (!value || getFieldValue("password") === value) {
									return Promise.resolve();
								}
								return Promise.reject(
									new Error(t("signupComplete.passwordMismatch"))
								);
							},
						}),
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("signupComplete.confirmPassword")}
						size="large"
						autoComplete="new-password"
					/>
				</Form.Item>

				<Form.Item shouldUpdate>
					{() => (
						<Button
							type="primary"
							htmlType="submit"
							size="large"
							block
							disabled={
								!token ||
								!form.isFieldsTouched(true) ||
								form.getFieldsError().some(({ errors }) => errors.length > 0)
							}
						>
							{t("signupComplete.submit")}
						</Button>
					)}
				</Form.Item>
			</Form>
		</Spin>
	);
}
