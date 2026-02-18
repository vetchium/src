import { App, Modal, Spin, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OrgDisableUserRequest } from "vetchium-specs/employer/employer-users";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Text } = Typography;

interface DisableUserModalProps {
	email: string | null;
	visible: boolean;
	onCancel: () => void;
	onSuccess: () => void;
}

export function DisableUserModal({
	email,
	visible,
	onCancel,
	onSuccess,
}: DisableUserModalProps) {
	const { t } = useTranslation("userManagement");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const { data: myInfo } = useMyInfo(sessionToken);

	const [loading, setLoading] = useState(false);

	const handleDisable = async () => {
		if (!email) return;

		// Prevent disabling yourself
		if (myInfo?.org_user_id === email) {
			message.error(t("errors.cannotDisableSelf"));
			return;
		}

		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: OrgDisableUserRequest = {
				email_address: email,
			};

			const response = await fetch(`${apiBaseUrl}/employer/disable-user`, {
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

			if (response.status === 404) {
				message.error(t("errors.userNotFound"));
				return;
			}

			if (response.status === 422) {
				message.error(t("errors.invalidState"));
				return;
			}

			if (response.status === 200) {
				message.success(t("success.userDisabled"));
				onSuccess();
			}
		} catch (err) {
			console.error("Failed to disable user:", err);
			message.error(t("errors.disableFailed"));
		} finally {
			setLoading(false);
		}
	};

	return (
		<Modal
			title={t("disableModal.title")}
			open={visible}
			onOk={handleDisable}
			onCancel={onCancel}
			confirmLoading={loading}
			okText={t("disableModal.confirm")}
			cancelText={t("disableModal.cancel")}
			okButtonProps={{ danger: true }}
		>
			<Spin spinning={loading}>
				<div style={{ marginBottom: 16 }}>
					<Text>{t("disableModal.message")}</Text>
				</div>
				<div style={{ marginBottom: 16 }}>
					<Text strong>{t("disableModal.email")}:</Text> <Text>{email}</Text>
				</div>
				<div>
					<Text type="warning">{t("disableModal.warning")}</Text>
				</div>
			</Spin>
		</Modal>
	);
}
