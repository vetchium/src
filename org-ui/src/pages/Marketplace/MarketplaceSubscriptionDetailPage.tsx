import { ArrowLeftOutlined } from "@ant-design/icons";
import { useState, useCallback, useEffect } from "react";
import {
	Alert,
	Button,
	Card,
	Descriptions,
	Modal,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { getApiBaseUrl } from "../../config";
import type {
	GetSubscriptionRequest,
	MarketplaceSubscription,
	MarketplaceSubscriptionStatus,
	CancelSubscriptionRequest,
} from "vetchium-specs/org/marketplace";

const { Title, Text } = Typography;

const statusColors: Record<MarketplaceSubscriptionStatus, string> = {
	active: "green",
	cancelled: "red",
	expired: "default",
};

export function MarketplaceSubscriptionDetailPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const navigate = useNavigate();
	const { subscription_id } = useParams<{ subscription_id: string }>();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_subscriptions") ||
		false;

	const [subscription, setSubscription] =
		useState<MarketplaceSubscription | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [showCancelModal, setShowCancelModal] = useState(false);
	const [cancelling, setCancelling] = useState(false);

	const fetchSubscription = useCallback(async () => {
		if (!sessionToken || !subscription_id) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const reqBody: GetSubscriptionRequest = { subscription_id };
			const resp = await fetch(
				`${apiBaseUrl}/org/marketplace/subscriptions/get`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(reqBody),
				}
			);
			if (resp.status === 200) {
				const data: MarketplaceSubscription = await resp.json();
				setSubscription(data);
				setError(null);
			} else {
				setError(t("subscriptionDetail.errors.loadFailed"));
			}
		} catch {
			setError(t("subscriptionDetail.errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [sessionToken, subscription_id, t]);

	useEffect(() => {
		fetchSubscription();
	}, [fetchSubscription]);

	const handleCancel = async () => {
		if (!sessionToken || !subscription_id) return;
		setCancelling(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const reqBody: CancelSubscriptionRequest = { subscription_id };
			const resp = await fetch(
				`${apiBaseUrl}/org/marketplace/subscriptions/cancel`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(reqBody),
				}
			);
			if (resp.status === 200) {
				setShowCancelModal(false);
				fetchSubscription();
			}
		} finally {
			setCancelling(false);
		}
	};

	if (loading) {
		return (
			<div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
				<Spin size="large" />
			</div>
		);
	}

	if (error || !subscription) {
		return (
			<div
				style={{
					width: "100%",
					maxWidth: 800,
					padding: "24px 16px",
					alignSelf: "flex-start",
				}}
			>
				<div style={{ marginBottom: 16 }}>
					<Link to="/marketplace/subscriptions">
						<Button icon={<ArrowLeftOutlined />}>
							{t("subscriptionDetail.backToSubscriptions")}
						</Button>
					</Link>
				</div>
				<Alert type="error" title={error ?? ""} />
			</div>
		);
	}

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 800,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to="/marketplace/subscriptions">
					<Button icon={<ArrowLeftOutlined />}>
						{t("subscriptionDetail.backToSubscriptions")}
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
					{subscription.provider_org_domain}
				</Title>
				<Tag color={statusColors[subscription.status]}>
					{t(`subscriptionDetail.statuses.${subscription.status}`)}
				</Tag>
			</div>

			<Card style={{ marginBottom: 24 }}>
				<Descriptions column={1}>
					<Descriptions.Item label={t("subscriptionDetail.provider")}>
						{subscription.provider_org_domain}
					</Descriptions.Item>
					<Descriptions.Item label={t("subscriptionDetail.capability")}>
						<Tag color="blue">{subscription.capability_id}</Tag>
					</Descriptions.Item>
					<Descriptions.Item label={t("subscriptionDetail.listingId")}>
						<Button
							type="link"
							style={{ padding: 0 }}
							onClick={() =>
								navigate(
									`/marketplace/discover/${subscription.listing_id}`
								)
							}
						>
							{t("subscriptionDetail.viewListing")}
						</Button>
					</Descriptions.Item>
					<Descriptions.Item label={t("subscriptionDetail.status")}>
						<Tag color={statusColors[subscription.status]}>
							{t(`subscriptionDetail.statuses.${subscription.status}`)}
						</Tag>
					</Descriptions.Item>
					<Descriptions.Item label={t("subscriptionDetail.startedAt")}>
						{new Date(subscription.started_at).toLocaleDateString()}
					</Descriptions.Item>
					{subscription.expires_at && (
						<Descriptions.Item label={t("subscriptionDetail.expiresAt")}>
							{new Date(subscription.expires_at).toLocaleDateString()}
						</Descriptions.Item>
					)}
					{subscription.cancelled_at && (
						<Descriptions.Item label={t("subscriptionDetail.cancelledAt")}>
							{new Date(subscription.cancelled_at).toLocaleDateString()}
						</Descriptions.Item>
					)}
					{subscription.request_note && (
						<Descriptions.Item label={t("subscriptionDetail.requestNote")}>
							<Text>{subscription.request_note}</Text>
						</Descriptions.Item>
					)}
				</Descriptions>
			</Card>

			{canManage && (
				<Space>
					{subscription.status === "active" && (
						<Button danger onClick={() => setShowCancelModal(true)}>
							{t("subscriptionDetail.cancelButton")}
						</Button>
					)}
					{(subscription.status === "cancelled" ||
						subscription.status === "expired") && (
						<Button
							type="primary"
							onClick={() =>
								navigate(
									`/marketplace/discover/${subscription.listing_id}`
								)
							}
						>
							{t("subscriptionDetail.resubscribeButton")}
						</Button>
					)}
				</Space>
			)}

			<Modal
				title={t("subscriptionDetail.cancelTitle")}
				open={showCancelModal}
				onOk={handleCancel}
				onCancel={() => setShowCancelModal(false)}
				confirmLoading={cancelling}
			>
				{t("subscriptionDetail.cancelConfirm")}
			</Modal>
		</div>
	);
}
