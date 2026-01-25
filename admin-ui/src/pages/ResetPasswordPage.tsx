import { useState, useEffect } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { Form, Input, Button, Card, Typography, Alert, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { getApiBaseUrl } from "../config";

const { Title, Text } = Typography;

export function ResetPasswordPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const token = searchParams.get("token");

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!token) {
			setError("Invalid or missing reset token.");
		}
	}, [token]);

	const onFinish = async (values: { password: string }) => {
		if (!token) return;

		setLoading(true);
		setError(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(
				`${apiBaseUrl}/admin/complete-password-reset`,
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
				message.success("Password has been reset successfully. Please login.");
				navigate("/login");
			} else {
				const data = await response.json();
				if (response.status === 401) {
					setError("The reset link has expired or is invalid.");
				} else {
					setError(data.message || "Failed to reset password.");
				}
			}
		} catch (err) {
			setError("Failed to connect to the server. Please try again later.");
			console.error("Reset password error:", err);
		} finally {
			setLoading(false);
		}
	};

	if (!token) {
		return (
			<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
				<Alert
					message="Invalid Link"
					description="The password reset link is invalid or missing."
					type="error"
					showIcon
				/>
				<div style={{ marginTop: 24, textAlign: "center" }}>
					<Link to="/login">
						<Button type="primary">Back to Login</Button>
					</Link>
				</div>
			</Card>
		);
	}

	return (
		<Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
			<div style={{ textAlign: "center", marginBottom: 24 }}>
				<Title level={3}>Set New Password</Title>
				<Text type="secondary">Please enter your new password below.</Text>
			</div>

			{error && (
				<Alert
					message={error}
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
					label="New Password"
					rules={[
						{ required: true, message: "Please input your new password!" },
						{ min: 12, message: "Password must be at least 12 characters" },
					]}
					hasFeedback
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder="New Password"
						size="large"
					/>
				</Form.Item>

				<Form.Item
					name="confirm"
					label="Confirm Password"
					dependencies={["password"]}
					hasFeedback
					rules={[
						{ required: true, message: "Please confirm your password!" },
						({ getFieldValue }) => ({
							validator(_, value) {
								if (!value || getFieldValue("password") === value) {
									return Promise.resolve();
								}
								return Promise.reject(
									new Error("The two passwords that you entered do not match!")
								);
							},
						}),
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder="Confirm Password"
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
						Reset Password
					</Button>
				</Form.Item>
			</Form>
		</Card>
	);
}
