import { App, Modal, Spin, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgencyEnableUserRequest } from "vetchium-specs/agency/agency-users";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Text } = Typography;

interface EnableUserModalProps {
	email: string | null;
	visible: boolean;
	onCancel: () => void;
	onSuccess: () => void;
}

export function EnableUserModal({
	email,
	visible,
	onCancel,
	onSuccess,
}: EnableUserModalProps) {
	const { t } = useTranslation("userManagement");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();

	const [loading, setLoading] = useState(false);

	const handleEnable = async () => {
		if (!email) return;

		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const request: AgencyEnableUserRequest = {
				email_address: email,
			};

			const response = await fetch(`${apiBaseUrl}/agency/enable-user`, {
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
				message.success(t("success.userEnabled"));
				onSuccess();
			}
		} catch (err) {
			console.error("Failed to enable user:", err);
			message.error(t("errors.enableFailed"));
		} finally {
			setLoading(false);
		}
	};

	return (
		<Modal
			title={t("enableModal.title")}
			open={visible}
			onOk={handleEnable}
			onCancel={onCancel}
			confirmLoading={loading}
			okText={t("enableModal.confirm")}
			cancelText={t("enableModal.cancel")}
		>
			<Spin spinning={loading}>
				<div style={{ marginBottom: 16 }}>
					<Text>{t("enableModal.message")}</Text>
				</div>
				<div style={{ marginBottom: 16 }}>
					<Text strong>{t("enableModal.email")}:</Text> <Text>{email}</Text>
				</div>
				<div>
					<Text type="secondary">{t("enableModal.info")}</Text>
				</div>
			</Spin>
		</Modal>
	);
}
