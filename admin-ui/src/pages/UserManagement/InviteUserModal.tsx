import { useState } from "react";
import { Modal, Form, Input, message } from "antd";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

interface InviteUserModalProps {
    visible: boolean;
    onCancel: () => void;
    onSuccess: () => void;
}

export function InviteUserModal({
    visible,
    onCancel,
    onSuccess,
}: InviteUserModalProps) {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const { sessionToken } = useAuth();

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            setLoading(true);

            const apiBaseUrl = await getApiBaseUrl();
            const response = await fetch(`${apiBaseUrl}/admin/invite-user`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${sessionToken}`,
                },
                body: JSON.stringify({
                    email_address: values.email,
                    full_name: values.fullName,
                }),
            });

            if (response.ok) {
                message.success("User invited successfully");
                form.resetFields();
                onSuccess();
            } else {
                const data = await response.json();
                // Handle specific errors like 409 Conflict
                if (response.status === 409) {
                    message.error("User with this email already exists.");
                } else {
                    message.error(data.message || "Failed to invite user");
                }
            }
        } catch (error) {
            console.error("Invite user failed:", error);
            // Form validation errors are handled by Ant Design automatically
            if (!(error as { errorFields?: [] }).errorFields) {
                message.error("An error occurred while inviting the user.");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            title="Invite User"
            open={visible}
            onOk={handleOk}
            onCancel={onCancel}
            confirmLoading={loading}
        >
            <Form form={form} layout="vertical">
                <Form.Item
                    name="fullName"
                    label="Full Name"
                    rules={[{ required: true, message: "Please enter full name" }]}
                >
                    <Input placeholder="Full Name" />
                </Form.Item>
                <Form.Item
                    name="email"
                    label="Email Address"
                    rules={[
                        { required: true, message: "Please enter email address" },
                        { type: "email", message: "Please enter a valid email" },
                    ]}
                >
                    <Input placeholder="Email Address" />
                </Form.Item>
            </Form>
        </Modal>
    );
}
