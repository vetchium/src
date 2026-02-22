import { useState } from "react";
import { Link } from "react-router-dom";
import { Form, Input, Button, Card, Typography, Alert } from "antd";
import { MailOutlined, GlobalOutlined } from "@ant-design/icons";
import { getApiBaseUrl } from "../config";

const { Title, Text } = Typography;

export function ForgotPasswordPage() {
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onFinish = async (values: { email: string; domain: string }) => {
		setLoading(true);
		setError(null);
		setSuccess(false);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(
				`${apiBaseUrl}/employer/request-password-reset`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						email_address: values.email,
						domain: values.domain,
					}),
				}
			);

			// Always show success message to prevent account enumeration
			if (response.ok || response.status === 200 || response.status === 404) {
				setSuccess(true);
			} else {
				const data = await response.json();
				setError(data.message || "An error occurred. Please try again.");
			}
		} catch (err) {
			setError("Failed to connect to the server. Please try again later.");
			console.error("Forgot password error:", err);
		} finally {
			setLoading(false);
		}
	};

	if (success) {
		return (
			<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
				<div style={{ textAlign: "center" }}>
					<Title level={3}>Check Your Email</Title>
					<Text>
						If an account exists for that email in the specified domain, we have
						sent password reset instructions.
					</Text>
					<div style={{ marginTop: 24 }}>
						<Link to="/login">
							<Button type="primary" block>
								Back to Login
							</Button>
						</Link>
					</div>
				</div>
			</Card>
		);
	}

	return (
		<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
			<div style={{ textAlign: "center", marginBottom: 24 }}>
				<Title level={3}>Reset Password</Title>
				<Text type="secondary">
					Enter your email and domain to reset your password.
				</Text>
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
				name="forgot_password"
				onFinish={onFinish}
				layout="vertical"
				requiredMark={false}
			>
				<Form.Item
					name="domain"
					rules={[{ required: true, message: "Please input your domain!" }]}
				>
					<Input
						prefix={<GlobalOutlined />}
						placeholder="Domain (e.g., example.com)"
						size="large"
					/>
				</Form.Item>

				<Form.Item
					name="email"
					rules={[
						{ required: true, message: "Please input your email!" },
						{ type: "email", message: "Please enter a valid email!" },
					]}
				>
					<Input
						prefix={<MailOutlined />}
						placeholder="Email Address"
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
						Send Reset Link
					</Button>
				</Form.Item>

				<div style={{ textAlign: "center" }}>
					<Link to="/login">Back to Login</Link>
				</div>
			</Form>
		</Card>
	);
}
