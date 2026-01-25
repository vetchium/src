import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Form, Input, Button, Card, Typography, Alert, message, Spin } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { getApiBaseUrl } from "../config";

const { Title, Text } = Typography;

export function CompleteSetupPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get("token");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!token) {
            setError("Invalid or missing invitation token.");
        }
    }, [token]);

    const onFinish = async (values: { password: string; fullName: string }) => {
        if (!token) return;

        setLoading(true);
        setError(null);

        try {
            const apiBaseUrl = await getApiBaseUrl();
            const response = await fetch(`${apiBaseUrl}/admin/complete-setup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    invitation_token: token,
                    password: values.password,
                    full_name: values.fullName,
                }),
            });

            if (response.ok) {
                message.success("Account activated successfully. Please login.");
                navigate("/login");
            } else {
                const data = await response.json();
                if (response.status === 401) {
                    setError("The invitation link has expired or is invalid.");
                } else {
                    setError(data.message || "Failed to complete setup.");
                }
            }
        } catch (err) {
            setError("Failed to connect to the server. Please try again later.");
            console.error("Complete setup error:", err);
        } finally {
            setLoading(false);
        }
    };

    if (!token) {
        return (
            <Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <Alert
                    message="Invalid Link"
                    description="The invitation link is invalid or missing."
                    type="error"
                    showIcon
                />
                <div style={{ marginTop: 24, textAlign: "center" }}>
                    <Link to="/login">
                        <Button type="primary">Go to Login</Button>
                    </Link>
                </div>
            </Card>
        );
    }

    return (
        <Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
                <Title level={3}>Complete Account Setup</Title>
                <Text type="secondary">
                    Set your password to activate your account.
                </Text>
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
                name="complete_setup"
                onFinish={onFinish}
                layout="vertical"
                requiredMark={false}
            >
                <Form.Item
                    name="fullName"
                    label="Full Name"
                    rules={[{ required: true, message: "Please input your full name!" }]}
                >
                    <Input
                        prefix={<UserOutlined />}
                        placeholder="Full Name"
                        size="large"
                    />
                </Form.Item>

                <Form.Item
                    name="password"
                    label="Create Password"
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
                                    new Error("The two passwords do not match!")
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
                        Activate Account
                    </Button>
                </Form.Item>
            </Form>
        </Card>
    );
}
