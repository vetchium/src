import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Descriptions,
	Modal,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import type {
	CancelConsumerSubscriptionRequest,
	MarketplaceSubscription,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title } = Typography;

function subscriptionStatusColor(status: string): string {
	switch (status) {
		case "active":
			return "green";
		case "provider_review":
		case "admin_review":
		case "awaiting_contract":
		case "awaiting_payment":
		case "requested":
			return "gold";
		case "rejected":
		case "cancelled":
			return "red";
		case "expired":
			return "default";
		default:
			return "default";
	}
}

export function MarketplacePurchaseDetailPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();
	const { provider_org_domain, capability_slug } = useParams<{
		provider_org_domain: string;
		capability_slug: string;
	}>();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_marketplace") ||
		false;

	const [subscription, setSubscription] =
		useState<MarketplaceSubscription | null>(null);
	const [loading, setLoading] = useState(false);
	const [cancelLoading, setCancelLoading] = useState(false);
	const [cancelModalOpen, setCancelModalOpen] = useState(false);

	const loadSubscription = useCallback(async () => {
		if (!sessionToken || !capability_slug || !provider_org_domain) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/marketplace/consumer-subscriptions/get`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ provider_org_domain, capability_slug }),
				}
			);
			if (resp.status === 200) {
				const data: MarketplaceSubscription = await resp.json();
				setSubscription(data);
			} else {
				message.error(t("purchaseDetail.errors.loadFailed"));
			}
		} catch {
			message.error(t("purchaseDetail.errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [sessionToken, capability_slug, provider_org_domain, message, t]);

	useEffect(() => {
		loadSubscription();
	}, [loadSubscription]);

	const handleCancel = async () => {
		if (!sessionToken || !capability_slug || !provider_org_domain) return;
		setCancelLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: CancelConsumerSubscriptionRequest = {
				provider_org_domain,
				capability_slug,
			};
			const resp = await fetch(
				`${baseUrl}/org/marketplace/consumer-subscriptions/cancel`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				}
			);
			if (resp.status === 200 || resp.status === 204) {
				message.success(t("purchaseDetail.success.cancelled"));
				setCancelModalOpen(false);
				loadSubscription();
			} else {
				message.error(t("purchaseDetail.errors.cancelFailed"));
			}
		} catch {
			message.error(t("purchaseDetail.errors.cancelFailed"));
		} finally {
			setCancelLoading(false);
		}
	};

	const canCancel =
		subscription &&
		(subscription.status === "requested" ||
			subscription.status === "provider_review" ||
			subscription.status === "admin_review" ||
			subscription.status === "awaiting_contract" ||
			subscription.status === "awaiting_payment" ||
			subscription.status === "active");

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
				<Link to="/marketplace/purchases">
					<Button icon={<ArrowLeftOutlined />}>
						{t("purchaseDetail.backToPurchases")}
					</Button>
				</Link>
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 24,
				}}
			>
				<Title level={2} style={{ margin: 0 }}>
					{t("purchaseDetail.title")}
				</Title>
				{canManage && canCancel && (
					<Button danger onClick={() => setCancelModalOpen(true)}>
						{t("purchaseDetail.cancelButton")}
					</Button>
				)}
			</div>

			<Spin spinning={loading}>
				{subscription && (
					<Descriptions column={{ xs: 1, sm: 2 }} bordered>
						<Descriptions.Item label={t("purchaseDetail.provider")}>
							{subscription.provider_org_domain}
						</Descriptions.Item>
						<Descriptions.Item label={t("purchaseDetail.capability")}>
							{subscription.capability_slug}
						</Descriptions.Item>
						<Descriptions.Item label={t("purchaseDetail.status")}>
							<Tag color={subscriptionStatusColor(subscription.status)}>
								{t(
									`purchaseDetail.subscriptionStatuses.${subscription.status}`
								)}
							</Tag>
						</Descriptions.Item>
						<Descriptions.Item label={t("purchaseDetail.createdAt")}>
							{new Date(subscription.created_at).toLocaleString()}
						</Descriptions.Item>
						{subscription.starts_at && (
							<Descriptions.Item label={t("purchaseDetail.startsAt")}>
								{new Date(subscription.starts_at).toLocaleString()}
							</Descriptions.Item>
						)}
						{subscription.expires_at && (
							<Descriptions.Item label={t("purchaseDetail.expiresAt")}>
								{new Date(subscription.expires_at).toLocaleString()}
							</Descriptions.Item>
						)}
						{subscription.request_note && (
							<Descriptions.Item
								label={t("purchaseDetail.requestNote")}
								span={2}
							>
								{subscription.request_note}
							</Descriptions.Item>
						)}
						{subscription.review_note && (
							<Descriptions.Item
								label={t("purchaseDetail.reviewNote")}
								span={2}
							>
								{subscription.review_note}
							</Descriptions.Item>
						)}
					</Descriptions>
				)}
			</Spin>

			<Modal
				title={t("purchaseDetail.cancelButton")}
				open={cancelModalOpen}
				onCancel={() => setCancelModalOpen(false)}
				onOk={handleCancel}
				okText={t("purchaseDetail.cancelButton")}
				okButtonProps={{ danger: true, loading: cancelLoading }}
				cancelButtonProps={{ disabled: cancelLoading }}
				destroyOnHidden
			>
				{t("purchaseDetail.confirmCancel")}
			</Modal>
		</div>
	);
}
