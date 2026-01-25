import { useState } from "react";
import { Form, Input, Button, Card, Typography, Alert } from "antd";
import { MailOutlined } from "@ant-design/icons";
import { getApiBaseUrl } from "../config";
import { useAuth } from "../hooks/useAuth";

const { Title, Text } = Typography;

export function ChangeEmailPage() {
    const { sessionToken } = useAuth();
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
                setError(data.message || "Failed to request email change.");
            }
        } catch (err) {
            setError("Failed to connect to the server. Please try again later.");
            console.error("Change email error:", err);
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <div style={{ textAlign: "center" }}>
                    <Title level={3}>Check New Email</Title>
                    <Text>
                        We have sent a verification link to your new email address.
                        Please click the link to confirm the change.
                    </Text>
                </div>
            </Card>
        );
    }

    return (
        <Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
            <Title level={3} style={{ textAlign: "center", marginBottom: 24 }}>
                Change Email
            </Title>

            {error && (
                <Alert
                    message={error}
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
                    label="New Email Address"
                    rules={[
                        { required: true, message: "Please input new email!" },
                        { type: "email", message: "Please enter a valid email!" },
                    ]}
                >
                    <Input prefix={<MailOutlined />} placeholder="New Email Address" />
                </Form.Item>

                <Form.Item>
                    <Button type="primary" htmlType="submit" block loading={loading}>
                        Send Verification Link
                    </Button>
                </Form.Item>
            </Form>
        </Card>
    );
}
