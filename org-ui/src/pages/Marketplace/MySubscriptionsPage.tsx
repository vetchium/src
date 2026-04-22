import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Select, Spin, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	MarketplaceSubscription,
	MarketplaceSubscriptionStatus,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title } = Typography;

const SUB_STATUS_COLORS: Record<MarketplaceSubscriptionStatus, string> = {
	active: "success",
	cancelled: "error",
	expired: "warning",
};

export function MySubscriptionsPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();

	const [subscriptions, setSubscriptions] = useState<MarketplaceSubscription[]>(
		[]
	);
	const [loading, setLoading] = useState(false);
	const [nextKey, setNextKey] = useState<string | undefined>();
	const [filterStatus, setFilterStatus] = useState<
		MarketplaceSubscriptionStatus | undefined
	>();

	const loadSubscriptions = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const resp = await fetch(
					`${baseUrl}/org/marketplace/subscription/list`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify({
							...(filterStatus ? { filter_status: filterStatus } : {}),
							...(paginationKey ? { pagination_key: paginationKey } : {}),
							limit: 20,
						}),
					}
				);
				if (resp.status === 200) {
					const data = await resp.json();
					if (paginationKey) {
						setSubscriptions((prev) => [
							...prev,
							...(data.subscriptions || []),
						]);
					} else {
						setSubscriptions(data.subscriptions || []);
					}
					setNextKey(data.next_pagination_key);
				}
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, filterStatus]
	);

	useEffect(() => {
		loadSubscriptions();
	}, [loadSubscriptions]);

	const columns = [
		{
			title: t("subscriptions.provider"),
			dataIndex: "provider_org_domain",
			key: "provider_org_domain",
		},
		{
			title: t("subscriptions.status"),
			dataIndex: "status",
			key: "status",
			render: (status: MarketplaceSubscriptionStatus) => (
				<Tag color={SUB_STATUS_COLORS[status]}>{t(`subStatus.${status}`)}</Tag>
			),
		},
		{
			title: t("subscriptions.subscribedAt"),
			dataIndex: "started_at",
			key: "started_at",
			render: (v: string) => new Date(v).toLocaleDateString(),
		},
		{
			title: t("subscriptions.actions"),
			key: "actions",
			render: (_: unknown, record: MarketplaceSubscription) => (
				<Button
					size="small"
					onClick={() =>
						navigate(
							`/marketplace/subscriptions/${record.provider_org_domain}/${record.provider_listing_number}`
						)
					}
				>
					{t("subscriptions.view")}
				</Button>
			),
		},
	];

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
				{t("subscriptions.title")}
			</Title>

			<div style={{ marginBottom: 16 }}>
				<Select
					allowClear
					placeholder={t("subscriptions.filterByStatus")}
					style={{ width: 200 }}
					onChange={(val) =>
						setFilterStatus(val as MarketplaceSubscriptionStatus | undefined)
					}
					options={[
						{ value: "active", label: t("subStatus.active") },
						{ value: "cancelled", label: t("subStatus.cancelled") },
						{ value: "expired", label: t("subStatus.expired") },
					]}
				/>
			</div>

			<Spin spinning={loading}>
				<Table
					dataSource={subscriptions}
					columns={columns}
					rowKey="subscription_id"
					pagination={false}
					footer={() =>
						nextKey ? (
							<div style={{ textAlign: "center" }}>
								<Button onClick={() => loadSubscriptions(nextKey)}>
									{t("loadMore")}
								</Button>
							</div>
						) : null
					}
				/>
			</Spin>
		</div>
	);
}
