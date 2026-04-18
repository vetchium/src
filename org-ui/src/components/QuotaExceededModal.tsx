import { Modal, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const { Text } = Typography;

export interface QuotaExceededPayload {
	quota: string;
	current_cap: number;
	tier_id: string;
}

interface QuotaExceededModalProps {
	open: boolean;
	payload: QuotaExceededPayload | null;
	onClose: () => void;
}

export function QuotaExceededModal({
	open,
	payload,
	onClose,
}: QuotaExceededModalProps) {
	const { t } = useTranslation("subscription");

	return (
		<Modal
			open={open}
			title={t("quotaExceeded.title")}
			onCancel={onClose}
			footer={null}
		>
			{payload && (
				<div>
					<Text>
						{t("quotaExceeded.message", {
							quota: payload.quota,
							cap: payload.current_cap,
							tier: payload.tier_id,
						})}
					</Text>
					<div style={{ marginTop: 16 }}>
						<Link to="/settings/subscription" onClick={onClose}>
							{t("quotaExceeded.viewPlans")}
						</Link>
					</div>
				</div>
			)}
		</Modal>
	);
}
