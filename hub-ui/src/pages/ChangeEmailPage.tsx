import { useState } from "react";
import { Form, Input, Button, Card, Typography, Alert } from "antd";
import { MailOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";

const { Title, Text } = Typography;

export function ChangeEmailPage() {
	const { sessionToken } = useAuth();
	const { t } = useTranslation("auth");
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onFinish = async (values: { email: string }) => {
		setLoading(true);
		setError(null);
		setSuccess(false);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/hub/request-email-change`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ new_email_address: values.email }),
			});

			if (response.ok) {
				setSuccess(true);
			} else {
				const data = await response.json();
				setError(data.message || t("changeEmail.failed"));
			}
		} catch (err) {
			setError(t("changeEmail.failed"));
			console.error("Change email error:", err);
		} finally {
			setLoading(false);
		}
	};

	if (success) {
		return (
			<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
				<div style={{ textAlign: "center" }}>
					<Title level={3}>{t("changeEmail.successTitle")}</Title>
					<Text>{t("changeEmail.successMessage")}</Text>
				</div>
			</Card>
		);
	}

	return (
		<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
			<Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
				{t("changeEmail.title")}
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
				name="change_email"
				onFinish={onFinish}
				layout="vertical"
				requiredMark={false}
			>
				<Form.Item
					name="email"
					label={t("changeEmail.newEmailLabel")}
					rules={[
						{
							required: true,
							message: t("changeEmail.emailRequired"),
						},
						{
							type: "email",
							message: t("changeEmail.emailInvalid"),
						},
					]}
				>
					<Input
						prefix={<MailOutlined />}
						placeholder={t("changeEmail.newEmailPlaceholder")}
					/>
				</Form.Item>

				<Form.Item>
					<Button type="primary" htmlType="submit" block loading={loading}>
						{t("changeEmail.submit")}
					</Button>
				</Form.Item>
			</Form>
		</Card>
	);
}
