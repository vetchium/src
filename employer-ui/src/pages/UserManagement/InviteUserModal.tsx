import { useState } from "react";
import { Modal, Form, Input, Select, message } from "antd";
import type { OrgInviteUserRequest } from "vetchium-specs/employer/employer-users";
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
	const { t } = useTranslation("userManagement");

	const handleOk = async () => {
		try {
			const values = await form.validateFields();
			setLoading(true);

			const request: OrgInviteUserRequest = {
				email_address: values.email,
				roles: values.roles,
				...(values.inviteEmailLanguage && {
					invite_email_language: values.inviteEmailLanguage,
				}),
			};

			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/employer/invite-user`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.ok) {
				message.success(t("success.userInvited"));
				form.resetFields();
				onSuccess();
			} else {
				const data = await response.json();
				if (response.status === 409) {
					message.error(t("inviteModal.userExists"));
				} else {
					message.error(data.message || t("inviteModal.inviteFailedGeneral"));
				}
			}
		} catch (error) {
			console.error("Invite user failed:", error);
			if (!(error as { errorFields?: [] }).errorFields) {
				message.error(t("inviteModal.inviteFailed"));
			}
		} finally {
			setLoading(false);
		}
	};

	return (
		<Modal
			title={t("inviteModal.title")}
			open={visible}
			onOk={handleOk}
			onCancel={onCancel}
			confirmLoading={loading}
			okText={t("inviteModal.confirm")}
			cancelText={t("inviteModal.cancel")}
		>
			<Form form={form} layout="vertical">
				<Form.Item
					name="email"
					label={t("inviteModal.email")}
					rules={[
						{ required: true, message: t("inviteModal.emailRequired") },
						{ type: "email", message: t("inviteModal.emailInvalid") },
					]}
				>
					<Input placeholder={t("inviteModal.emailPlaceholder")} />
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
								value: "employer:invite_users",
							},
							{
								label: t("inviteModal.roleManageUsers"),
								value: "employer:manage_users",
							},
							{
								label: t("inviteModal.roleSuperadmin"),
								value: "employer:superadmin",
							},
						]}
					/>
				</Form.Item>
				<Form.Item
					name="inviteEmailLanguage"
					label={t("inviteModal.inviteEmailLanguage")}
					tooltip={t("inviteModal.inviteEmailLanguageTooltip")}
				>
					<Select
						placeholder={t("inviteModal.inviteEmailLanguagePlaceholder")}
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
