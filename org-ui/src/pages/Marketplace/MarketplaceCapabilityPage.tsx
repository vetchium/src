import {
	ArrowLeftOutlined,
	CheckCircleOutlined,
	ClockCircleOutlined,
	ExclamationCircleOutlined,
	TeamOutlined,
} from "@ant-design/icons";
import {
	Alert,
	App,
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
import { Link, useNavigate } from "react-router-dom";
import type {
	ApplyMarketplaceProviderCapabilityRequest,
	OrgCapability,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Text, Paragraph } = Typography;

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
			return "orange";
		default:
			return "default";
	}
}

function StatusIcon({ status }: { status: string }) {
	switch (status) {
		case "active":
			return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
		case "pending_approval":
			return <ClockCircleOutlined style={{ color: "#faad14" }} />;
		case "rejected":
		case "revoked":
			return <ExclamationCircleOutlined style={{ color: "#f5222d" }} />;
		default:
			return null;
	}
}

export function MarketplaceCapabilityPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const navigate = useNavigate();

	const [capability, setCapability] = useState<OrgCapability | null>(null);
	const [loading, setLoading] = useState(true);
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
		<div
			style={{
				width: "100%",
				maxWidth: 1200,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to="/">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>

			<Spin spinning={loading}>
				{/* Page header */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 16,
						marginBottom: 8,
					}}
				>
					<TeamOutlined style={{ fontSize: 36, color: "#1890ff" }} />
					<div>
						<Title level={2} style={{ margin: 0 }}>
							{t("providerHub.talentSourcing.title")}
						</Title>
						<Paragraph type="secondary" style={{ margin: 0, marginTop: 4 }}>
							{t("providerHub.talentSourcing.description")}
						</Paragraph>
					</div>
				</div>

				<div style={{ marginBottom: 32 }} />

				{/* No application yet */}
				{!capability && !loading && (
					<Card style={{ marginBottom: 24 }}>
						<div style={{ textAlign: "center", padding: "24px 0" }}>
							<TeamOutlined
								style={{ fontSize: 48, color: "#d9d9d9", marginBottom: 16 }}
							/>
							<Title level={4} style={{ color: "#8c8c8c" }}>
								{t("capability.notApplied")}
							</Title>
							<Paragraph type="secondary">
								{t("capability.applyDescription")}
							</Paragraph>
						</div>
					</Card>
				)}

				{/* Existing capability status */}
				{capability && (
					<Card
						style={{ marginBottom: 24 }}
						extra={
							<Tag color={statusColor(capability.status)}>
								<StatusIcon status={capability.status} />{" "}
								{t(`capability.statuses.${capability.status}`)}
							</Tag>
						}
						title={t("capability.currentStatus")}
					>
						<Descriptions column={2} size="small">
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
							{capability.subscription_price !== undefined && (
								<Descriptions.Item label={t("capability.subscriptionPrice")}>
									{capability.subscription_price}
									{capability.currency && ` ${capability.currency}`}
								</Descriptions.Item>
							)}
						</Descriptions>

						{capability.application_note && (
							<div style={{ marginTop: 12 }}>
								<Text type="secondary">
									{t("capability.applicationNote")}:{" "}
								</Text>
								<Text>{capability.application_note}</Text>
							</div>
						)}

						{capability.admin_note && (
							<Alert
								title={capability.admin_note}
								type={
									capability.status === "rejected" ||
									capability.status === "revoked"
										? "error"
										: "info"
								}
								showIcon
								style={{ marginTop: 12 }}
							/>
						)}

						{/* Manage listings button when active */}
						{capability.status === "active" && (
							<div style={{ marginTop: 16 }}>
								<Button
									type="primary"
									onClick={() => navigate("/marketplace/service-listings")}
								>
									{t("capability.manageListings")}
								</Button>
							</div>
						)}
					</Card>
				)}

				{/* Apply / Re-apply form */}
				{canApply && !showApplyForm && (
					<Button type="primary" onClick={() => setShowApplyForm(true)}>
						{capability ? t("capability.reapply") : t("capability.apply")}
					</Button>
				)}

				{showApplyForm && (
					<Card
						title={
							capability
								? t("capability.reapplyTitle")
								: t("capability.applyTitle")
						}
						style={{ maxWidth: 640 }}
					>
						<Form layout="vertical">
							<Form.Item
								label={t("capability.applicationNote")}
								extra={
									applicationNote.length > 1000 ? (
										<Text type="danger">
											{t("capability.errors.applicationNoteTooLong")}
										</Text>
									) : (
										<Text type="secondary">
											{t("capability.applicationNoteHint")}
										</Text>
									)
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
		</div>
	);
}
