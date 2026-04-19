import { ArrowLeftOutlined, CrownOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Card,
	Col,
	Descriptions,
	Modal,
	Row,
	Spin,
	Table,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	OrgSubscription,
	OrgTier,
	ListOrgTiersResponse,
	SelfUpgradeOrgSubscriptionRequest,
} from "vetchium-specs/org/tiers";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Text } = Typography;

export function SubscriptionPage() {
	const { t } = useTranslation("subscription");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();

	const [subscription, setSubscription] = useState<OrgSubscription | null>(
		null
	);
	const [tiers, setTiers] = useState<OrgTier[]>([]);
	const [loading, setLoading] = useState(true);
	const [upgrading, setUpgrading] = useState(false);

	const fetchData = useCallback(async () => {
		if (!sessionToken) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const headers = {
				"Content-Type": "application/json",
				Authorization: `Bearer ${sessionToken}`,
			};

			const [subResp, tiersResp] = await Promise.all([
				fetch(`${baseUrl}/org/org-subscriptions/get`, {
					method: "POST",
					headers,
					body: "{}",
				}),
				fetch(`${baseUrl}/org/org-subscriptions/list-tiers`, {
					method: "POST",
					headers,
					body: "{}",
				}),
			]);

			if (subResp.status === 200) {
				const data: OrgSubscription = await subResp.json();
				setSubscription(data);
			}
			if (tiersResp.status === 200) {
				const data: ListOrgTiersResponse = await tiersResp.json();
				setTiers(data.tiers);
			}
		} catch {
			message.error(t("errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [sessionToken, message, t]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const handleUpgrade = async (tier: OrgTier) => {
		Modal.confirm({
			title: t("upgradeModal.title", { tier: tier.display_name }),
			content: t("upgradeModal.content", { tier: tier.display_name }),
			okText: t("upgradeModal.confirm"),
			cancelText: t("upgradeModal.cancel"),
			onOk: async () => {
				setUpgrading(true);
				try {
					const baseUrl = await getApiBaseUrl();
					const req: SelfUpgradeOrgSubscriptionRequest = {
						tier_id: tier.tier_id,
					};
					const resp = await fetch(
						`${baseUrl}/org/org-subscriptions/self-upgrade`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${sessionToken}`,
							},
							body: JSON.stringify(req),
						}
					);
					if (resp.status === 200) {
						message.success(t("success.upgraded", { tier: tier.display_name }));
						await fetchData();
					} else if (resp.status === 422) {
						message.error(t("errors.upgradeNotAllowed"));
					} else {
						message.error(t("errors.upgradeFailed"));
					}
				} catch {
					message.error(t("errors.upgradeFailed"));
				} finally {
					setUpgrading(false);
				}
			},
		});
	};

	const usageColumns = [
		{
			title: t("usage.resource"),
			dataIndex: "resource",
			key: "resource",
		},
		{
			title: t("usage.current"),
			dataIndex: "current",
			key: "current",
		},
		{
			title: t("usage.cap"),
			dataIndex: "cap",
			key: "cap",
			render: (cap: number | null) =>
				cap == null ? t("usage.unlimited") : cap,
		},
	];

	const usageData = subscription
		? [
				{
					key: "org_users",
					resource: t("usage.orgUsers"),
					current: subscription.usage.org_users,
					cap: subscription.current_tier.org_users_cap ?? null,
				},
				{
					key: "domains",
					resource: t("usage.domainsVerified"),
					current: subscription.usage.domains_verified,
					cap: subscription.current_tier.domains_verified_cap ?? null,
				},
				{
					key: "suborgs",
					resource: t("usage.suborgs"),
					current: subscription.usage.suborgs,
					cap: subscription.current_tier.suborgs_cap ?? null,
				},
				{
					key: "listings",
					resource: t("usage.marketplaceListings"),
					current: subscription.usage.marketplace_listings,
					cap: subscription.current_tier.marketplace_listings_cap ?? null,
				},
			]
		: [];

	if (loading) {
		return (
			<div style={{ textAlign: "center", padding: 48 }}>
				<Spin size="large" />
			</div>
		);
	}

	const currentDisplayOrder = subscription?.current_tier.display_order ?? 0;

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

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("title")}
			</Title>

			{subscription && (
				<>
					<Card style={{ marginBottom: 24 }}>
						<Descriptions title={t("currentTier.title")} column={1}>
							<Descriptions.Item label={t("currentTier.name")}>
								<Text strong>{subscription.current_tier.display_name}</Text>
							</Descriptions.Item>
							<Descriptions.Item label={t("currentTier.description")}>
								{subscription.current_tier.description || "-"}
							</Descriptions.Item>
							<Descriptions.Item label={t("currentTier.updatedAt")}>
								{new Date(subscription.updated_at).toLocaleDateString()}
							</Descriptions.Item>
						</Descriptions>
					</Card>

					<Card title={t("usage.title")} style={{ marginBottom: 24 }}>
						<Table
							dataSource={usageData}
							columns={usageColumns}
							pagination={false}
							size="small"
						/>
					</Card>
				</>
			)}

			<Card title={t("plans.title")}>
				<Spin spinning={upgrading}>
					<Row gutter={[16, 16]}>
						{tiers.map((tier) => {
							const isCurrent =
								tier.tier_id === subscription?.current_tier.tier_id;
							const canUpgrade =
								tier.self_upgradeable &&
								tier.display_order > currentDisplayOrder;

							return (
								<Col key={tier.tier_id} xs={24} sm={12} lg={6}>
									<Card
										style={{
											height: "100%",
											borderColor: isCurrent ? "#1890ff" : undefined,
										}}
									>
										<div style={{ textAlign: "center", marginBottom: 16 }}>
											<CrownOutlined
												style={{
													fontSize: 32,
													color: isCurrent ? "#1890ff" : "#999",
												}}
											/>
											<Title level={4} style={{ marginBottom: 4 }}>
												{tier.display_name}
											</Title>
											{isCurrent && (
												<Text type="secondary">{t("plans.currentBadge")}</Text>
											)}
										</div>
										<div style={{ marginBottom: 12 }}>
											<div>
												{t("plans.orgUsers")}:{" "}
												{tier.org_users_cap != null
													? tier.org_users_cap
													: t("plans.unlimited")}
											</div>
											<div>
												{t("plans.domains")}:{" "}
												{tier.domains_verified_cap != null
													? tier.domains_verified_cap
													: t("plans.unlimited")}
											</div>
											<div>
												{t("plans.suborgs")}:{" "}
												{tier.suborgs_cap != null
													? tier.suborgs_cap
													: t("plans.unlimited")}
											</div>
											<div>
												{t("plans.listings")}:{" "}
												{tier.marketplace_listings_cap != null
													? tier.marketplace_listings_cap
													: t("plans.unlimited")}
											</div>
										</div>
										{tier.tier_id === "enterprise" ? (
											<Text type="secondary">
												{t("plans.enterpriseContact")}
											</Text>
										) : canUpgrade ? (
											<Button
												type="primary"
												block
												onClick={() => handleUpgrade(tier)}
											>
												{t("plans.upgradeButton", { tier: tier.display_name })}
											</Button>
										) : null}
									</Card>
								</Col>
							);
						})}
					</Row>
				</Spin>
			</Card>
		</div>
	);
}
