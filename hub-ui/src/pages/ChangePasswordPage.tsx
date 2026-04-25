import { LockOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, message, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";

const { Title } = Typography;

export function ChangePasswordPage() {
	const { sessionToken, logout } = useAuth();
	const { t } = useTranslation("auth");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [form] = Form.useForm();

	const onFinish = async (values: { current: string; new: string }) => {
		setLoading(true);
		setError(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/change-password`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({
					current_password: values.current,
					new_password: values.new,
				}),
			});

			if (response.ok) {
				message.success(t("changePassword.success"));
				// Spec says: "All existing sessions except current are invalidated".
				// User stays logged in.
				form.resetFields();
			} else {
				const data = await response.json();
				if (response.status === 401) {
					setError(t("changePassword.incorrectPassword"));
					if (data.message === "Invalid session") {
						logout();
					}
				} else {
					setError(data.message || t("changePassword.failed"));
				}
			}
		} catch (err) {
			setError(t("changePassword.failed"));
			console.error("Change password error:", err);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
			<Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
				{t("changePassword.title")}
			</Title>

			{error && (
				<Alert
					title={error}
					type="error"
					showIcon
					style={{ marginBottom: 24 }}
				/>
			)}

			<Form
				form={form}
				name="change_password"
				onFinish={onFinish}
				layout="vertical"
				requiredMark={false}
			>
				<Form.Item
					name="current"
					label={t("changePassword.currentPasswordLabel")}
					rules={[
						{
							required: true,
							message: t("changePassword.currentPasswordRequired"),
						},
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("changePassword.currentPasswordPlaceholder")}
					/>
				</Form.Item>

				<Form.Item
					name="new"
					label={t("changePassword.newPasswordLabel")}
					rules={[
						{
							required: true,
							message: t("changePassword.newPasswordRequired"),
						},
						{
							min: 12,
							message: t("changePassword.passwordMinLength", { min: 12 }),
						},
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("changePassword.newPasswordPlaceholder")}
					/>
				</Form.Item>

				<Form.Item
					name="confirm"
					label={t("changePassword.confirmPasswordLabel")}
					dependencies={["new"]}
					rules={[
						{
							required: true,
							message: t("changePassword.confirmPasswordRequired"),
						},
						({ getFieldValue }) => ({
							validator(_, value) {
								if (!value || getFieldValue("new") === value) {
									return Promise.resolve();
								}
								return Promise.reject(
									new Error(t("changePassword.passwordMismatch"))
								);
							},
						}),
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("changePassword.confirmPasswordPlaceholder")}
					/>
				</Form.Item>

				<Form.Item>
					<Button type="primary" htmlType="submit" block loading={loading}>
						{t("changePassword.submit")}
					</Button>
				</Form.Item>
			</Form>
		</Card>
	);
}
