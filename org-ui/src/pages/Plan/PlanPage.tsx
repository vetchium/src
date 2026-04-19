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
	OrgPlan,
	Plan,
	ListPlansResponse,
	UpgradeOrgPlanRequest,
} from "vetchium-specs/org/tiers";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Text } = Typography;

export function PlanPage() {
	const { t } = useTranslation("plan");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();

	const [subscription, setSubscription] = useState<OrgPlan | null>(null);
	const [plans, setPlans] = useState<Plan[]>([]);
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

			const [subResp, plansResp] = await Promise.all([
				fetch(`${baseUrl}/org/org-plan/get`, {
					method: "POST",
					headers,
					body: "{}",
				}),
				fetch(`${baseUrl}/org/org-plan/list-plans`, {
					method: "POST",
					headers,
					body: "{}",
				}),
			]);

			if (subResp.status === 200) {
				const data: OrgPlan = await subResp.json();
				setSubscription(data);
			}
			if (plansResp.status === 200) {
				const data: ListPlansResponse = await plansResp.json();
				setPlans(data.plans);
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

	const handleUpgrade = async (plan: Plan) => {
		Modal.confirm({
			title: t("upgradeModal.title", { plan: plan.display_name }),
			content: t("upgradeModal.content", { plan: plan.display_name }),
			okText: t("upgradeModal.confirm"),
			cancelText: t("upgradeModal.cancel"),
			onOk: async () => {
				setUpgrading(true);
				try {
					const baseUrl = await getApiBaseUrl();
					const req: UpgradeOrgPlanRequest = {
						plan_id: plan.plan_id,
					};
					const resp = await fetch(`${baseUrl}/org/org-plan/upgrade`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify(req),
					});
					if (resp.status === 200) {
						message.success(t("success.upgraded", { plan: plan.display_name }));
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
					cap: subscription.current_plan.org_users_cap ?? null,
				},
				{
					key: "domains",
					resource: t("usage.domainsVerified"),
					current: subscription.usage.domains_verified,
					cap: subscription.current_plan.domains_verified_cap ?? null,
				},
				{
					key: "suborgs",
					resource: t("usage.suborgs"),
					current: subscription.usage.suborgs,
					cap: subscription.current_plan.suborgs_cap ?? null,
				},
				{
					key: "listings",
					resource: t("usage.marketplaceListings"),
					current: subscription.usage.marketplace_listings,
					cap: subscription.current_plan.marketplace_listings_cap ?? null,
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

	const currentDisplayOrder = subscription?.current_plan.display_order ?? 0;

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
						<Descriptions title={t("currentPlan.title")} column={1}>
							<Descriptions.Item label={t("currentPlan.name")}>
								<Text strong>{subscription.current_plan.display_name}</Text>
							</Descriptions.Item>
							<Descriptions.Item label={t("currentPlan.description")}>
								{subscription.current_plan.description || "-"}
							</Descriptions.Item>
							<Descriptions.Item label={t("currentPlan.updatedAt")}>
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
						{plans.map((plan) => {
							const isCurrent =
								plan.plan_id === subscription?.current_plan.plan_id;
							const canUpgrade =
								plan.self_upgradeable &&
								plan.display_order > currentDisplayOrder;

							return (
								<Col key={plan.plan_id} xs={24} sm={12} lg={6}>
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
												{plan.display_name}
											</Title>
											{isCurrent && (
												<Text type="secondary">{t("plans.currentBadge")}</Text>
											)}
										</div>
										<div style={{ marginBottom: 12 }}>
											<div>
												{t("plans.orgUsers")}:{" "}
												{plan.org_users_cap != null
													? plan.org_users_cap
													: t("plans.unlimited")}
											</div>
											<div>
												{t("plans.domains")}:{" "}
												{plan.domains_verified_cap != null
													? plan.domains_verified_cap
													: t("plans.unlimited")}
											</div>
											<div>
												{t("plans.suborgs")}:{" "}
												{plan.suborgs_cap != null
													? plan.suborgs_cap
													: t("plans.unlimited")}
											</div>
											<div>
												{t("plans.listings")}:{" "}
												{plan.marketplace_listings_cap != null
													? plan.marketplace_listings_cap
													: t("plans.unlimited")}
											</div>
										</div>
										{plan.plan_id === "enterprise" ? (
											<Text type="secondary">
												{t("plans.enterpriseContact")}
											</Text>
										) : canUpgrade ? (
											<Button
												type="primary"
												block
												onClick={() => handleUpgrade(plan)}
											>
												{t("plans.upgradeButton", { plan: plan.display_name })}
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
