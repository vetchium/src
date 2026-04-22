import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Card,
	Descriptions,
	Popconfirm,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	MarketplaceSubscription,
	MarketplaceSubscriptionStatus,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title } = Typography;

const SUB_STATUS_COLORS: Record<MarketplaceSubscriptionStatus, string> = {
	active: "success",
	cancelled: "error",
	expired: "warning",
};

export function SubscriptionDetailPage() {
	const { t } = useTranslation("marketplace");
	const { providerOrgDomain, listingNumber } = useParams<{
		providerOrgDomain: string;
		listingNumber: string;
	}>();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const navigate = useNavigate();
	const { message } = App.useApp();

	const [subscription, setSubscription] =
		useState<MarketplaceSubscription | null>(null);
	const [loading, setLoading] = useState(true);
	const [cancelling, setCancelling] = useState(false);

	const canManageSubscriptions =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_subscriptions") ||
		false;

	const loadSubscription = useCallback(async () => {
		if (!sessionToken || !providerOrgDomain || !listingNumber) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/subscription/get`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({
					provider_org_domain: providerOrgDomain,
					provider_listing_number: parseInt(listingNumber, 10),
				}),
			});
			if (resp.status === 200) {
				const data = await resp.json();
				setSubscription(data);
			} else {
				navigate("/marketplace/subscriptions");
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, providerOrgDomain, listingNumber, navigate]);

	useEffect(() => {
		loadSubscription();
	}, [loadSubscription]);

	const handleCancel = async () => {
		if (!sessionToken || !subscription) return;
		setCancelling(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/marketplace/subscription/cancel`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						subscription_id: subscription.subscription_id,
					}),
				}
			);
			if (resp.status === 200) {
				message.success(t("subscriptionDetail.cancelSuccess"));
				loadSubscription();
			} else {
				message.error(t("subscriptionDetail.cancelError"));
			}
		} finally {
			setCancelling(false);
		}
	};

	if (loading) {
		return (
			<div style={{ textAlign: "center", padding: 64 }}>
				<Spin size="large" />
			</div>
		);
	}

	if (!subscription) {
		return null;
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
				<Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
					{t("subscriptionDetail.back")}
				</Button>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("subscriptionDetail.title")}
			</Title>

			<Card>
				<Descriptions column={1} bordered>
					<Descriptions.Item label={t("subscriptionDetail.provider")}>
						<Link
							to={`/marketplace/listings/${subscription.provider_org_domain}/${subscription.provider_listing_number}`}
						>
							{subscription.provider_org_domain}
						</Link>
					</Descriptions.Item>
					<Descriptions.Item label={t("subscriptionDetail.status")}>
						<Tag color={SUB_STATUS_COLORS[subscription.status]}>
							{t(`subStatus.${subscription.status}`)}
						</Tag>
					</Descriptions.Item>
					<Descriptions.Item label={t("subscriptionDetail.subscribedAt")}>
						{new Date(subscription.started_at).toLocaleString()}
					</Descriptions.Item>
					{subscription.cancelled_at && (
						<Descriptions.Item label={t("subscriptionDetail.cancelledAt")}>
							{new Date(subscription.cancelled_at).toLocaleString()}
						</Descriptions.Item>
					)}
					{subscription.expires_at && (
						<Descriptions.Item label={t("subscriptionDetail.expiresAt")}>
							{new Date(subscription.expires_at).toLocaleString()}
						</Descriptions.Item>
					)}
				</Descriptions>
			</Card>

			{canManageSubscriptions && subscription.status === "active" && (
				<div style={{ marginTop: 24 }}>
					<Popconfirm
						title={t("subscriptionDetail.confirmCancel")}
						onConfirm={handleCancel}
						okText={t("subscriptionDetail.confirmCancelOk")}
						cancelText={t("subscriptionDetail.confirmCancelNo")}
						okButtonProps={{ danger: true }}
					>
						<Button danger loading={cancelling}>
							{t("subscriptionDetail.cancel")}
						</Button>
					</Popconfirm>
				</div>
			)}
		</div>
	);
}
