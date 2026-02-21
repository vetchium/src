import { useState } from "react";
import { Modal, Form, Input, Select, message } from "antd";
import type { AgencyInviteUserRequest } from "vetchium-specs/agency/agency-users";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { SUPPORTED_LANGUAGES } from "../../i18n";
import { useTranslation } from "react-i18next";

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
	const { t } = useTranslation("user-management");

	const handleOk = async () => {
		try {
			const values = await form.validateFields();
			setLoading(true);

			const request: AgencyInviteUserRequest = {
				email_address: values.email,
				roles: values.roles,
				...(values.inviteEmailLanguage && {
					invite_email_language: values.inviteEmailLanguage,
				}),
			};

			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/agency/invite-user`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.ok) {
				message.success("User invited successfully");
				form.resetFields();
				onSuccess();
			} else {
				const data = await response.json();
				if (response.status === 409) {
					message.error("User with this email already exists.");
				} else {
					message.error(data.message || "Failed to invite user");
				}
			}
		} catch (error) {
			console.error("Invite user failed:", error);
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
					name="email"
					label="Email Address"
					rules={[
						{ required: true, message: "Please enter email address" },
						{ type: "email", message: "Please enter a valid email" },
					]}
				>
					<Input placeholder="Email Address" />
				</Form.Item>
				<Form.Item
					name="roles"
					label={t("inviteModal.rolesLabel")}
					rules={[
						{
							required: true,
							message: t("inviteModal.rolesRequired"),
						},
					]}
				>
					<Select
						mode="multiple"
						placeholder={t("inviteModal.rolesPlaceholder")}
						options={[
							{
								label: t("inviteModal.roleInviteUsers"),
								value: "agency:invite_users",
							},
							{
								label: t("inviteModal.roleManageUsers"),
								value: "agency:manage_users",
							},
							{
								label: t("inviteModal.roleSuperadmin"),
								value: "agency:superadmin",
							},
						]}
					/>
				</Form.Item>
				<Form.Item
					name="inviteEmailLanguage"
					label="Invitation Email Language"
					tooltip="Language for the invitation email. Defaults to your language if not specified."
				>
					<Select
						placeholder="Select language for invitation email (optional)"
						allowClear
						options={SUPPORTED_LANGUAGES.map((lang) => ({
							label: lang,
							value: lang,
						}))}
					/>
				</Form.Item>
			</Form>
		</Modal>
	);
}
