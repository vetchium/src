import { useState, useEffect } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { Form, Input, Button, Card, Typography, Alert, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { getApiBaseUrl } from "../config";

const { Title, Text } = Typography;

export function ResetPasswordPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { t } = useTranslation("auth");
	const token = searchParams.get("token");

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!token) {
			setError(t("resetPassword.invalidToken"));
		}
	}, [token, t]);

	const onFinish = async (values: { password: string }) => {
		if (!token) return;

		setLoading(true);
		setError(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(
				`${apiBaseUrl}/hub/complete-password-reset`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						reset_token: token,
						new_password: values.password,
					}),
				}
			);

			if (response.ok) {
				message.success(t("resetPassword.success"));
				navigate("/login");
			} else {
				const data = await response.json();
				if (response.status === 401) {
					setError(t("resetPassword.linkExpired"));
				} else {
					setError(data.message || t("resetPassword.failed"));
				}
			}
		} catch (err) {
			setError(t("resetPassword.failed"));
			console.error("Reset password error:", err);
		} finally {
			setLoading(false);
		}
	};

	if (!token) {
		return (
			<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
				<Alert
					title={t("resetPassword.invalidLinkTitle")}
					description={t("resetPassword.invalidLinkDesc")}
					type="error"
					showIcon
				/>
				<div style={{ marginTop: 24, textAlign: "center" }}>
					<Link to="/login">
						<Button type="primary">{t("resetPassword.backToLogin")}</Button>
					</Link>
				</div>
			</Card>
		);
	}

	return (
		<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
			<div style={{ textAlign: "center", marginBottom: 24 }}>
				<Title level={3}>{t("resetPassword.title")}</Title>
				<Text type="secondary">{t("resetPassword.subtitle")}</Text>
			</div>

			{error && (
				<Alert
					title={error}
					type="error"
					showIcon
					style={{ marginBottom: 24 }}
				/>
			)}

			<Form
				name="reset_password"
				onFinish={onFinish}
				layout="vertical"
				requiredMark={false}
			>
				<Form.Item
					name="password"
					label={t("resetPassword.newPasswordLabel")}
					rules={[
						{
							required: true,
							message: t("resetPassword.newPasswordRequired"),
						},
						{
							min: 12,
							message: t("resetPassword.passwordMinLength", { min: 12 }),
						},
					]}
					hasFeedback
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("resetPassword.newPasswordPlaceholder")}
						size="large"
					/>
				</Form.Item>

				<Form.Item
					name="confirm"
					label={t("resetPassword.confirmPasswordLabel")}
					dependencies={["password"]}
					hasFeedback
					rules={[
						{
							required: true,
							message: t("resetPassword.confirmPasswordRequired"),
						},
						({ getFieldValue }) => ({
							validator(_, value) {
								if (!value || getFieldValue("password") === value) {
									return Promise.resolve();
								}
								return Promise.reject(
									new Error(t("resetPassword.passwordMismatch"))
								);
							},
						}),
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("resetPassword.confirmPasswordPlaceholder")}
						size="large"
					/>
				</Form.Item>

				<Form.Item>
					<Button
						type="primary"
						htmlType="submit"
						block
						size="large"
						loading={loading}
					>
						{t("resetPassword.submit")}
					</Button>
				</Form.Item>
			</Form>
		</Card>
	);
}
