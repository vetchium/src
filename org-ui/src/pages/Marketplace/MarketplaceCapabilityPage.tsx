import {
	Alert,
	Button,
	Card,
	Descriptions,
	Form,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	ApplyMarketplaceProviderCapabilityRequest,
	OrgCapability,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { App } from "antd";

const { Title, Text } = Typography;

function statusColor(status: string): string {
	switch (status) {
		case "active":
			return "green";
		case "pending_approval":
			return "gold";
		case "rejected":
		case "revoked":
			return "red";
		case "expired":
			return "default";
		default:
			return "default";
	}
}

export function MarketplaceCapabilityPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();

	const [capability, setCapability] = useState<OrgCapability | null>(null);
	const [loading, setLoading] = useState(false);
	const [applyLoading, setApplyLoading] = useState(false);
	const [showApplyForm, setShowApplyForm] = useState(false);
	const [applicationNote, setApplicationNote] = useState("");

	const loadCapability = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/get-marketplace-provider-capability`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({}),
				}
			);
			if (resp.status === 200) {
				const data: OrgCapability = await resp.json();
				setCapability(data);
			} else if (resp.status === 404) {
				setCapability(null);
			} else {
				message.error(t("capability.errors.loadFailed"));
			}
		} catch {
			message.error(t("capability.errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [sessionToken, message, t]);

	useEffect(() => {
		loadCapability();
	}, [loadCapability]);

	const handleApply = async () => {
		if (!sessionToken) return;
		if (applicationNote.length > 1000) {
			message.error(t("capability.errors.applicationNoteTooLong"));
			return;
		}
		setApplyLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: ApplyMarketplaceProviderCapabilityRequest = applicationNote
				? { application_note: applicationNote }
				: {};
			const resp = await fetch(
				`${baseUrl}/org/apply-marketplace-provider-capability`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				}
			);
			if (resp.status === 200 || resp.status === 201) {
				message.success(t("capability.success.applied"));
				setShowApplyForm(false);
				setApplicationNote("");
				loadCapability();
			} else {
				message.error(t("capability.errors.applyFailed"));
			}
		} catch {
			message.error(t("capability.errors.applyFailed"));
		} finally {
			setApplyLoading(false);
		}
	};

	const canApply =
		!capability ||
		capability.status === "rejected" ||
		capability.status === "expired" ||
		capability.status === "revoked";

	return (
		<Spin spinning={loading}>
			<Title level={4}>{t("capability.title")}</Title>

			{!capability && !loading && (
				<Card style={{ marginBottom: 16 }}>
					<Text type="secondary">{t("capability.notApplied")}</Text>
				</Card>
			)}

			{capability && (
				<Card style={{ marginBottom: 16 }}>
					<Descriptions column={1} bordered size="small">
						<Descriptions.Item label={t("capability.status")}>
							<Tag color={statusColor(capability.status)}>
								{t(`capability.statuses.${capability.status}`)}
							</Tag>
						</Descriptions.Item>
						{capability.applied_at && (
							<Descriptions.Item label={t("capability.appliedAt")}>
								{new Date(capability.applied_at).toLocaleString()}
							</Descriptions.Item>
						)}
						{capability.granted_at && (
							<Descriptions.Item label={t("capability.grantedAt")}>
								{new Date(capability.granted_at).toLocaleString()}
							</Descriptions.Item>
						)}
						{capability.expires_at && (
							<Descriptions.Item label={t("capability.expiresAt")}>
								{new Date(capability.expires_at).toLocaleString()}
							</Descriptions.Item>
						)}
						{capability.subscription_price && (
							<Descriptions.Item label={t("capability.subscriptionPrice")}>
								{capability.subscription_price}{" "}
								{capability.currency && `(${capability.currency})`}
							</Descriptions.Item>
						)}
						{capability.application_note && (
							<Descriptions.Item label={t("capability.applicationNote")}>
								{capability.application_note}
							</Descriptions.Item>
						)}
						{capability.admin_note && (
							<Descriptions.Item label={t("capability.adminNote")}>
								<Alert
									title={capability.admin_note}
									type={
										capability.status === "rejected" ||
										capability.status === "revoked"
											? "error"
											: "info"
									}
									showIcon
								/>
							</Descriptions.Item>
						)}
					</Descriptions>
				</Card>
			)}

			{canApply && !showApplyForm && (
				<Button type="primary" onClick={() => setShowApplyForm(true)}>
					{capability ? t("capability.reapply") : t("capability.apply")}
				</Button>
			)}

			{showApplyForm && (
				<Card style={{ marginTop: 16 }}>
					<Form layout="vertical">
						<Form.Item
							label={t("capability.applicationNote")}
							extra={
								applicationNote.length > 1000 ? (
									<Text type="danger">
										{t("capability.errors.applicationNoteTooLong")}
									</Text>
								) : undefined
							}
						>
							<textarea
								style={{
									width: "100%",
									minHeight: 120,
									padding: 8,
									borderRadius: 6,
									border: "1px solid #d9d9d9",
									fontFamily: "inherit",
									fontSize: "inherit",
									resize: "vertical",
								}}
								placeholder={t("capability.applicationNotePlaceholder")}
								value={applicationNote}
								onChange={(e) => setApplicationNote(e.target.value)}
								maxLength={1100}
							/>
						</Form.Item>
						<div style={{ display: "flex", gap: 8 }}>
							<Button
								type="primary"
								loading={applyLoading}
								disabled={applicationNote.length > 1000}
								onClick={handleApply}
							>
								{t("capability.submitApplication")}
							</Button>
							<Button
								onClick={() => {
									setShowApplyForm(false);
									setApplicationNote("");
								}}
							>
								{t("common:cancel", "Cancel")}
							</Button>
						</div>
					</Form>
				</Card>
			)}
		</Spin>
	);
}
