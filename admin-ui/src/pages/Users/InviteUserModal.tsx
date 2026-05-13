import { App, Form, Input, Modal, Select, Spin } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AdminInviteUserRequest } from "vetchium-specs/admin/admin-users";
import { validateAdminInviteUserRequest } from "vetchium-specs/admin/admin-users";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { SUPPORTED_LANGUAGES } from "../../i18n";

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
	const { t } = useTranslation("userManagement");
	const [form] = Form.useForm();
	const [loading, setLoading] = useState(false);
	const [formValid, setFormValid] = useState(false);
	const { sessionToken } = useAuth();
	const { message } = App.useApp();

	const handleOk = async () => {
		try {
			const values = await form.validateFields();

			const request: AdminInviteUserRequest = {
				email_address: values.email,
				...(values.inviteEmailLanguage && {
					invite_email_language: values.inviteEmailLanguage,
				}),
			};

			const validationErrors = validateAdminInviteUserRequest(request);
			if (validationErrors.length > 0) {
				const errorMsg = validationErrors
					.map((e) => `${e.field}: ${e.message}`)
					.join(", ");
				message.error(errorMsg);
				return;
			}

			setLoading(true);

			const apiBaseUrl = await getApiBaseUrl();
			const response = await fetch(`${apiBaseUrl}/admin/invite-user`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(request),
			});

			if (response.status === 400) {
				const errors: unknown = await response.json();
				if (Array.isArray(errors)) {
					const errorMsg = errors
						.map(
							(e: { field: string; message: string }) =>
								`${e.field}: ${e.message}`
						)
						.join(", ");
					message.error(errorMsg);
				} else {
					message.error(t("errors.serverError"));
				}
				return;
			}

			if (response.status === 401) {
				message.error(t("errors.unauthorized"));
				return;
			}

			if (response.status === 403) {
				message.error(t("errors.forbidden"));
				return;
			}

			if (response.status === 409) {
				message.error(t("inviteModal.userExists"));
				return;
			}

			if (response.status === 201) {
				await response.json();
				message.success(t("success.userInvited"));
				form.resetFields();
				setFormValid(false);
				onSuccess();
			}
		} catch (error) {
			console.error("Invite user failed:", error);
			if (!(error as { errorFields?: [] }).errorFields) {
				message.error(t("errors.serverError"));
			}
		} finally {
			setLoading(false);
		}
	};

	const handleCancel = () => {
		form.resetFields();
		setFormValid(false);
		onCancel();
	};

	return (
		<Modal
			title={t("inviteModal.title")}
			open={visible}
			onOk={handleOk}
			onCancel={handleCancel}
			confirmLoading={loading}
			okText={t("inviteModal.confirm")}
			cancelText={t("inviteModal.cancel")}
			okButtonProps={{ disabled: !formValid }}
		>
			<Spin spinning={loading}>
				<Form
					form={form}
					layout="vertical"
					onFieldsChange={() => {
						const hasErrors = form
							.getFieldsError()
							.some(({ errors }) => errors.length > 0);
						const allTouched = form.isFieldsTouched(["email"], true);
						setFormValid(allTouched && !hasErrors);
					}}
				>
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
			</Spin>
		</Modal>
	);
}
