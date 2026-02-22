import { useState } from "react";
import { Form, Input, Button, Card, Typography, Alert, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";

const { Title } = Typography;

export function ChangePasswordPage() {
	const { sessionToken, logout } = useAuth();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onFinish = async (values: { current: string; new: string }) => {
		setLoading(true);
		setError(null);

		try {
			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/agency/change-password`, {
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
				message.success("Password changed successfully.");
				form.resetFields();
			} else {
				const data = await response.json();
				if (response.status === 401) {
					setError("Current password is incorrect or session expired.");
					if (data.message === "Invalid session") {
						logout();
					}
				} else {
					setError(data.message || "Failed to change password.");
				}
			}
		} catch (err) {
			setError("Failed to connect to the server. Please try again later.");
			console.error("Change password error:", err);
		} finally {
			setLoading(false);
		}
	};

	const [form] = Form.useForm();

	return (
		<Card>
			<Title level={3} style={{ marginBottom: 24 }}>
				Change Password
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
				style={{ maxWidth: 400 }}
			>
				<Form.Item
					name="current"
					label="Current Password"
					rules={[{ required: true, message: "Please enter current password" }]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder="Current Password"
					/>
				</Form.Item>

				<Form.Item
					name="new"
					label="New Password"
					rules={[
						{ required: true, message: "Please enter new password" },
						{ min: 12, message: "Password must be at least 12 characters" },
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder="New Password"
					/>
				</Form.Item>

				<Form.Item
					name="confirm"
					label="Confirm New Password"
					dependencies={["new"]}
					rules={[
						{ required: true, message: "Please confirm new password" },
						({ getFieldValue }) => ({
							validator(_, value) {
								if (!value || getFieldValue("new") === value) {
									return Promise.resolve();
								}
								return Promise.reject(
									new Error("The two passwords do not match!")
								);
							},
						}),
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder="Confirm New Password"
					/>
				</Form.Item>

				<Form.Item>
					<Button type="primary" htmlType="submit" loading={loading}>
						Update Password
					</Button>
				</Form.Item>
			</Form>
		</Card>
	);
}
